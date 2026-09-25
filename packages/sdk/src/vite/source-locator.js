import path from "node:path";

export const SOURCE_ATTRIBUTE = "data-artifact-source";
export const SOURCE_MAP_ENDPOINT = "/__artifact/source-map";

const RAW_TEXT_TAGS = new Set(["script", "style", "textarea", "title"]);

function hashSource(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function findTagEnd(html, start) {
  let quote = "";
  for (let index = start; index < html.length; index += 1) {
    const character = html[index];
    if (quote) {
      if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === ">") return index;
  }
  return -1;
}

function lineStartsFor(html) {
  const starts = [0];
  for (let index = 0; index < html.length; index += 1) {
    if (html.charCodeAt(index) === 10) starts.push(index + 1);
  }
  return starts;
}

function positionAt(lineStarts, offset) {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (lineStarts[middle] <= offset) low = middle + 1;
    else high = middle - 1;
  }
  const lineIndex = Math.max(0, high);
  return {
    line: lineIndex + 1,
    column: offset - lineStarts[lineIndex] + 1,
  };
}

function existingSourceId(startTag) {
  const match = startTag.match(/\sdata-artifact-source\s*=\s*(["'])([^"']+)\1/iu);
  return match?.[2] || "";
}

function insertionOffset(html, tagEnd) {
  let offset = tagEnd;
  let cursor = tagEnd - 1;
  while (cursor >= 0 && /\s/u.test(html[cursor])) cursor -= 1;
  if (html[cursor] === "/") {
    offset = cursor;
    while (offset > 0 && /\s/u.test(html[offset - 1])) offset -= 1;
  }
  return offset;
}

function collectHtmlInstrumentation(
  html,
  { file, sourceText = html, sourceOffset = 0 } = {},
) {
  const normalizedFile = String(file).replaceAll("\\", "/");
  const lowerHtml = html.toLowerCase();
  const lineStarts = lineStartsFor(sourceText);
  const insertions = [];
  const mappings = {};
  let cursor = 0;

  while (cursor < html.length) {
    const tagStart = html.indexOf("<", cursor);
    if (tagStart < 0) break;

    if (html.startsWith("<!--", tagStart)) {
      const commentEnd = html.indexOf("-->", tagStart + 4);
      cursor = commentEnd < 0 ? html.length : commentEnd + 3;
      continue;
    }

    const marker = html[tagStart + 1] || "";
    if (!/[A-Za-z]/u.test(marker)) {
      cursor = tagStart + 2;
      continue;
    }

    let nameEnd = tagStart + 2;
    while (nameEnd < html.length && /[A-Za-z0-9:_-]/u.test(html[nameEnd])) nameEnd += 1;
    const tagName = html.slice(tagStart + 1, nameEnd).toLowerCase();
    const tagEnd = findTagEnd(html, nameEnd);
    if (tagEnd < 0) break;

    const startTag = html.slice(tagStart, tagEnd + 1);
    const existingId = existingSourceId(startTag);
    const absoluteStart = sourceOffset + tagStart;
    const absoluteEnd = sourceOffset + tagEnd + 1;
    const sourceId = existingId
      || `s_${hashSource(`${normalizedFile}:${absoluteStart}:${tagName}`)}`;
    const position = positionAt(lineStarts, absoluteStart);
    mappings[sourceId] = {
      id: sourceId,
      file: normalizedFile,
      tagName,
      line: position.line,
      column: position.column,
      start: absoluteStart,
      end: absoluteEnd,
    };

    if (!existingId) {
      insertions.push({
        offset: sourceOffset + insertionOffset(html, tagEnd),
        text: ` ${SOURCE_ATTRIBUTE}="${sourceId}"`,
      });
    }

    cursor = tagEnd + 1;
    if (RAW_TEXT_TAGS.has(tagName) && !/\/\s*>$/u.test(startTag)) {
      const closeTag = lowerHtml.indexOf(`</${tagName}`, cursor);
      if (closeTag >= 0) cursor = closeTag;
    }
  }

  return { insertions, mappings };
}

function applyInsertions(source, insertions) {
  let transformed = source;
  for (const insertion of insertions.sort((left, right) => right.offset - left.offset)) {
    transformed = transformed.slice(0, insertion.offset)
      + insertion.text
      + transformed.slice(insertion.offset);
  }

  return transformed;
}

/**
 * 给静态 HTML 开始标签注入 source id，并返回 id 到原始源码位置的映射。
 * 映射位置均基于输入 HTML，而不是注入后的 HTML。
 */
export function instrumentHtml(html, { file = "index.html" } = {}) {
  if (typeof html !== "string") throw new TypeError("html 必须是字符串");
  const result = collectHtmlInstrumentation(html, { file });
  return {
    html: applyInsertions(html, result.insertions),
    mappings: result.mappings,
  };
}

function visitAst(value, visitor) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) visitAst(item, visitor);
    return;
  }
  if (typeof value.type === "string") visitor(value);
  for (const [key, child] of Object.entries(value)) {
    if (["start", "end", "loc", "range", "type"].includes(key)) continue;
    visitAst(child, visitor);
  }
}

function maskedTemplateSource(code, template) {
  const contentStart = template.start + 1;
  const contentEnd = template.end - 1;
  const masked = Array.from({ length: contentEnd - contentStart }, () => " ");
  for (const quasi of template.quasis || []) {
    const raw = code.slice(quasi.start, quasi.end);
    const relativeStart = quasi.start - contentStart;
    for (let index = 0; index < raw.length; index += 1) {
      masked[relativeStart + index] = raw[index];
    }
  }
  return { contentStart, source: masked.join("") };
}

/**
 * 给 JavaScript 模板字符串中的 HTML/SVG 标签注入 source id。
 * parse 由构建工具提供，避免插件在沙箱中携带额外解析器依赖。
 */
export function instrumentJavaScript(code, { file = "src/main.js", parse } = {}) {
  if (typeof code !== "string") throw new TypeError("code 必须是字符串");
  if (typeof parse !== "function") throw new TypeError("parse 必须是函数");

  const ast = parse(code);
  const templates = [];
  visitAst(ast, (node) => {
    if (node.type === "TemplateLiteral") templates.push(node);
  });
  templates.sort((left, right) => left.start - right.start);

  const insertions = [];
  const mappings = {};
  for (const template of templates) {
    const masked = maskedTemplateSource(code, template);
    const result = collectHtmlInstrumentation(masked.source, {
      file,
      sourceText: code,
      sourceOffset: masked.contentStart,
    });
    insertions.push(...result.insertions);
    Object.assign(mappings, result.mappings);
  }

  return {
    code: applyInsertions(code, insertions),
    mappings,
  };
}

export function artifactSourceLocator(options = {}) {
  const endpoint = options.endpoint || SOURCE_MAP_ENDPOINT;
  let root = process.cwd();
  const mappingsByFile = new Map();

  function allMappings() {
    return Object.assign({}, ...mappingsByFile.values());
  }

  return {
    name: "artifact-source-locator",
    enforce: "pre",
    configResolved(config) {
      root = config.root;
    },
    transformIndexHtml: {
      order: "pre",
      handler(html, context) {
        const filename = context.filename || path.join(root, "index.html");
        const relativeFile = path.relative(root, filename).split(path.sep).join("/");
        const result = instrumentHtml(html, { file: relativeFile || "index.html" });
        mappingsByFile.set(relativeFile, result.mappings);
        return result.html;
      },
    },
    transform(code, id) {
      const filename = id.split("?", 1)[0];
      if (!/\.[cm]?js$/iu.test(filename) || filename.includes("/node_modules/")) return null;
      const relativeFile = path.relative(root, filename).split(path.sep).join("/");
      const result = instrumentJavaScript(code, {
        file: relativeFile,
        parse: (source) => this.parse(source),
      });
      if (Object.keys(result.mappings).length === 0) {
        mappingsByFile.delete(relativeFile);
        return null;
      }
      mappingsByFile.set(relativeFile, result.mappings);
      return { code: result.code, map: null };
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url || "/", "http://localhost").pathname;
        if (!pathname.endsWith(endpoint)) {
          next();
          return;
        }
        response.statusCode = 200;
        response.setHeader("content-type", "application/json; charset=utf-8");
        response.setHeader("cache-control", "no-store");
        response.end(JSON.stringify({
          version: 1,
          capabilities: ["html", "javascript-template"],
          mappings: allMappings(),
        }));
      });
    },
  };
}

export default artifactSourceLocator;
