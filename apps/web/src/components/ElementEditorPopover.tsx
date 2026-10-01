import type {
  ElementEditorEditingState,
  ElementEditPropertyKey,
  ElementEditPropertyValue,
  ElementEditPropertyId,
  ElementEditGroup,
  ElementEditProperty,
} from "@artifact-editor/sdk/web/element-editor";
import type { CSSProperties } from "react";
import { useState, useEffect } from "react";
import {
  ImageIcon,
  Type,
  X,
  Bold,
  Italic,
  Sparkles,
  Check,
  SlidersHorizontal,
  ChevronDown,
  MousePointer2,
} from "lucide-react";
import { formatElementSelector } from "../format";

function editorProperty(
  state: ElementEditorEditingState,
  key: ElementEditPropertyKey,
) {
  return state.properties.find((property) => property.key === key);
}

function colorInputValue(value: ElementEditPropertyValue | undefined): string {
  if (typeof value !== "string") return "#222222";
  if (/^#[\da-f]{6}$/iu.test(value)) return value;
  if (/^#[\da-f]{3}$/iu.test(value)) {
    return `#${value
      .slice(1)
      .split("")
      .map((character) => character.repeat(2))
      .join("")}`;
  }
  const rgb = value.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/iu);
  if (!rgb) return "#222222";
  return `#${rgb
    .slice(1, 4)
    .map((channel) => Number(channel).toString(16).padStart(2, "0"))
    .join("")}`;
}

interface ElementEditorPopoverProps {
  state: ElementEditorEditingState;
  initialComment?: string;
  position: CSSProperties;
  placement: "above" | "below";
  onUpdate(
    property: ElementEditPropertyId,
    value: ElementEditPropertyValue,
  ): void;
  onCancel(): void;
  onCommit(comment: string): void;
}

const ELEMENT_PROPERTY_LABELS: Record<ElementEditPropertyKey, string> = {
  "content.text": "文本",
  "form.value": "内容",
  "form.placeholder": "占位文字",
  "form.checked": "选中",
  "form.disabled": "禁用",
  "link.href": "链接",
  "link.target": "打开方式",
  "media.src": "图片地址",
  "media.alt": "替代文本",
  "media.objectFit": "适应",
  "media.backgroundImage": "背景图片",
  "typography.fontFamily": "字体",
  "typography.fontSize": "字号",
  "typography.fontWeight": "字重",
  "typography.fontStyle": "字形",
  "typography.lineHeight": "行高",
  "typography.textAlign": "对齐",
  "typography.color": "文字颜色",
  "size.width": "宽度",
  "size.height": "高度",
  "size.aspectRatio": "比例",
  "layout.display": "显示",
  "layout.flexDirection": "排列方向",
  "layout.justifyContent": "主轴对齐",
  "layout.alignItems": "交叉轴对齐",
  "layout.gap": "间距",
  "spacing.marginTop": "上外边距",
  "spacing.marginRight": "右外边距",
  "spacing.marginBottom": "下外边距",
  "spacing.marginLeft": "左外边距",
  "spacing.paddingTop": "上内边距",
  "spacing.paddingRight": "右内边距",
  "spacing.paddingBottom": "下内边距",
  "spacing.paddingLeft": "左内边距",
  "appearance.backgroundColor": "背景颜色",
  "appearance.borderColor": "边框颜色",
  "appearance.borderWidth": "边框宽度",
  "appearance.borderStyle": "边框样式",
  "appearance.borderRadius": "圆角",
  "appearance.opacity": "透明度",
};

const ELEMENT_GROUP_LABELS: Record<ElementEditGroup, string> = {
  content: "内容",
  form: "表单",
  link: "链接",
  media: "媒体",
  typography: "排版",
  size: "尺寸",
  layout: "布局",
  spacing: "间距",
  appearance: "外观",
};

function lengthNumber(value: ElementEditPropertyValue): number {
  const parsed = Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function GenericElementEditorField({
  property,
  onUpdate,
}: {
  property: ElementEditProperty;
  onUpdate(
    property: ElementEditPropertyId,
    value: ElementEditPropertyValue,
  ): void;
}) {
  const label = ELEMENT_PROPERTY_LABELS[property.key];
  if (property.schema.kind === "boolean") {
    return (
      <label className="element-editor-toggle">
        <span>{label}</span>
        <input
          type="checkbox"
          checked={Boolean(property.value)}
          onChange={(event) => onUpdate(property.id, event.target.checked)}
        />
      </label>
    );
  }
  if (property.schema.kind === "choice") {
    return (
      <label className="element-editor-field">
        <span>{label}</span>
        <select
          value={String(property.value ?? "")}
          onChange={(event) => onUpdate(property.id, event.target.value)}
        >
          {property.schema.options.map((option) => (
            <option value={String(option)} key={String(option)}>
              {String(option)}
            </option>
          ))}
        </select>
      </label>
    );
  }
  if (property.schema.kind === "color") {
    return (
      <label className="element-editor-field">
        <span>{label}</span>
        <div className="element-editor-color-field">
          <input
            type="color"
            value={colorInputValue(property.value)}
            onChange={(event) => onUpdate(property.id, event.target.value)}
          />
          <code>{String(property.value)}</code>
        </div>
      </label>
    );
  }
  return (
    <label className="element-editor-field">
      <span>{label}</span>
      <input
        type={property.schema.kind === "number" ? "number" : "text"}
        min={
          property.schema.kind === "number" ? property.schema.min : undefined
        }
        max={
          property.schema.kind === "number" ? property.schema.max : undefined
        }
        step={
          property.schema.kind === "number" ? property.schema.step : undefined
        }
        value={String(property.value ?? "")}
        onChange={(event) =>
          onUpdate(
            property.id,
            property.schema.kind === "number"
              ? Number(event.target.value)
              : event.target.value,
          )
        }
      />
    </label>
  );
}

export function ElementEditorPopover({
  state,
  initialComment = "",
  position,
  placement,
  onUpdate,
  onCancel,
  onCommit,
}: ElementEditorPopoverProps) {
  const [activeTab, setActiveTab] = useState<"style" | "comment">("style");
  const [comment, setComment] = useState(initialComment);
  const text = editorProperty(state, "content.text");
  const fontSize = editorProperty(state, "typography.fontSize");
  const fontWeight = editorProperty(state, "typography.fontWeight");
  const fontStyle = editorProperty(state, "typography.fontStyle");
  const color = editorProperty(state, "typography.color");
  const imageSource = editorProperty(state, "media.src");
  const imageAlt = editorProperty(state, "media.alt");
  const objectFit = editorProperty(state, "media.objectFit");
  const width = editorProperty(state, "size.width");
  const height = editorProperty(state, "size.height");
  const aspectRatio = editorProperty(state, "size.aspectRatio");
  const isText = !!text;
  const isImage = !!imageSource;
  const elementLabel = isImage ? "图片" : isText ? "文本" : "元素";
  const elementSelector = formatElementSelector(state.target);
  const aspectRatioOptions = aspectRatio
    ? [
        ...new Set([
          String(aspectRatio.value),
          "auto",
          "1 / 1",
          "4 / 3",
          "16 / 9",
        ]),
      ]
    : [];
  const primaryPropertyIds = new Set(
    [
      ...(isText ? [text, fontSize, fontWeight, fontStyle, color] : []),
      ...(isImage
        ? [imageSource, imageAlt, objectFit, width, height, aspectRatio]
        : []),
    ]
      .filter((property): property is ElementEditProperty => !!property)
      .map((property) => property.id),
  );
  const detailGroups = state.properties
    .filter((property) => !primaryPropertyIds.has(property.id))
    .reduce((groups, property) => {
      const entries = groups.get(property.group) ?? [];
      entries.push(property);
      groups.set(property.group, entries);
      return groups;
    }, new Map<ElementEditGroup, ElementEditProperty[]>());

  useEffect(() => {
    setActiveTab("style");
    setComment(initialComment);
  }, [
    initialComment,
    state.target.hint,
    state.target.source?.file,
    state.target.source?.line,
    state.target.source?.column,
  ]);

  return (
    <section
      className={`element-editor-popover is-${placement}`}
      style={position}
      role="dialog"
      aria-label={`编辑 ${state.target.hint}`}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onCancel();
        }
      }}
    >
      <header className="element-editor-heading">
        <span className="element-editor-kind" aria-hidden="true">
          {isImage ? <ImageIcon size={17} /> : isText ? <Type size={17} /> : <MousePointer2 size={17} />}
        </span>
        <div className="element-editor-identity">
          <strong>编辑{elementLabel}</strong>
          <code title={state.target.hint}>{elementSelector}</code>
        </div>
        <button
          type="button"
          onClick={onCancel}
          aria-label="取消编辑"
          title="取消编辑"
        >
          <X size={14} />
        </button>
      </header>

      <div
        className="element-editor-tabs"
        role="tablist"
        aria-label="元素操作方式"
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "style"}
          className={activeTab === "style" ? "is-active" : ""}
          onClick={() => setActiveTab("style")}
        >
          <SlidersHorizontal size={14} />
          外观
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "comment"}
          className={activeTab === "comment" ? "is-active" : ""}
          onClick={() => setActiveTab("comment")}
        >
          <Sparkles size={14} />
          AI 修改
        </button>
      </div>

      {activeTab === "style" ? (
        <div className="element-editor-fields">
          {text && (
            <label className="element-editor-field is-wide">
              <span>文本</span>
              <input
                type="text"
                value={String(text.value)}
                onChange={(event) => onUpdate(text.id, event.target.value)}
              />
            </label>
          )}

          {isText && (
            <div className="element-editor-format-row">
              {fontWeight && (
                <button
                  type="button"
                  className={Number(fontWeight.value) >= 600 ? "is-active" : ""}
                  aria-label="粗体"
                  aria-pressed={Number(fontWeight.value) >= 600}
                  title="粗体"
                  onClick={() =>
                    onUpdate(
                      fontWeight.id,
                      Number(fontWeight.value) >= 600 ? 400 : 700,
                    )
                  }
                >
                  <Bold size={15} />
                </button>
              )}
              {fontStyle && (
                <button
                  type="button"
                  className={fontStyle.value !== "normal" ? "is-active" : ""}
                  aria-label="斜体"
                  aria-pressed={fontStyle.value !== "normal"}
                  title="斜体"
                  onClick={() =>
                    onUpdate(
                      fontStyle.id,
                      fontStyle.value === "normal" ? "italic" : "normal",
                    )
                  }
                >
                  <Italic size={15} />
                </button>
              )}
              {fontSize && (
                <label className="element-editor-compact-field" title="字号">
                  <input
                    aria-label="字号"
                    type="number"
                    min={1}
                    max={512}
                    value={lengthNumber(fontSize.value)}
                    onChange={(event) =>
                      onUpdate(fontSize.id, `${event.target.value}px`)
                    }
                  />
                  <span>px</span>
                </label>
              )}
              {color && (
                <label className="element-editor-color" title="文字颜色">
                  <input
                    aria-label="文字颜色"
                    type="color"
                    value={colorInputValue(color.value)}
                    onChange={(event) => onUpdate(color.id, event.target.value)}
                  />
                </label>
              )}
            </div>
          )}

          {imageSource && (
            <label className="element-editor-field is-wide">
              <span>图片地址</span>
              <input
                type="text"
                value={String(imageSource.value)}
                onChange={(event) =>
                  onUpdate(imageSource.id, event.target.value)
                }
              />
            </label>
          )}
          {imageAlt && (
            <label className="element-editor-field is-wide">
              <span>替代文本</span>
              <input
                type="text"
                value={String(imageAlt.value)}
                onChange={(event) => onUpdate(imageAlt.id, event.target.value)}
              />
            </label>
          )}
          {isImage && (
            <div className="element-editor-grid">
              {objectFit && objectFit.schema.kind === "choice" && (
                <label className="element-editor-field">
                  <span>适应</span>
                  <select
                    value={String(objectFit.value)}
                    onChange={(event) =>
                      onUpdate(objectFit.id, event.target.value)
                    }
                  >
                    {objectFit.schema.options.map((option) => (
                      <option value={String(option)} key={String(option)}>
                        {String(option)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {aspectRatio && (
                <label className="element-editor-field">
                  <span>比例</span>
                  <select
                    value={String(aspectRatio.value)}
                    onChange={(event) =>
                      onUpdate(aspectRatio.id, event.target.value)
                    }
                  >
                    {aspectRatioOptions.map((option) => (
                      <option value={option} key={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {width && (
                <label className="element-editor-field">
                  <span>宽度</span>
                  <div className="element-editor-number">
                    <input
                      type="number"
                      min={1}
                      value={lengthNumber(width.value)}
                      onChange={(event) =>
                        onUpdate(width.id, `${event.target.value}px`)
                      }
                    />
                    <i>px</i>
                  </div>
                </label>
              )}
              {height && (
                <label className="element-editor-field">
                  <span>高度</span>
                  <div className="element-editor-number">
                    <input
                      type="number"
                      min={1}
                      value={lengthNumber(height.value)}
                      onChange={(event) =>
                        onUpdate(height.id, `${event.target.value}px`)
                      }
                    />
                    <i>px</i>
                  </div>
                </label>
              )}
            </div>
          )}

          <div className="element-editor-groups">
            {[...detailGroups.entries()].map(([group, properties]) => (
              <details className="element-editor-group" key={group}>
                <summary>
                  <span>{ELEMENT_GROUP_LABELS[group]}</span>
                  <ChevronDown size={14} />
                </summary>
                <div className="element-editor-grid">
                  {properties.map((property) => (
                    <GenericElementEditorField
                      property={property}
                      onUpdate={onUpdate}
                      key={property.id}
                    />
                  ))}
                </div>
              </details>
            ))}
          </div>

          {state.properties.length === 0 && (
            <p className="element-editor-empty">
              这个元素暂时没有可直接编辑的属性。
            </p>
          )}
        </div>
      ) : (
        <div className="element-editor-comment">
          <label className="element-editor-comment-label" htmlFor="element-edit-comment">
            修改需求
          </label>
          <textarea
            id="element-edit-comment"
            autoFocus
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder="描述这个元素需要怎样调整…"
            rows={5}
          />
        </div>
      )}

      <footer className="element-editor-actions">
        <span className={`element-editor-edit-state ${state.dirty ? "is-dirty" : ""}`}>
          {state.dirty && <><i />已修改</>}
        </span>
        <button type="button" onClick={onCancel}>
          取消
        </button>
        <button
          type="button"
          className="is-primary"
          onClick={() => onCommit(comment.trim())}
        >
          <Check size={14} />
          {activeTab === "comment" ? "添加到列表" : "保存到列表"}
        </button>
      </footer>
    </section>
  );
}
