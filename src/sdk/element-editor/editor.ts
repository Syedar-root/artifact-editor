import type { ElementInspection, ElementSelection } from "../element-inspector/types.ts";
import { builtinPropertyAdapters } from "./adapters/index.ts";
import { collectBindings } from "./binding.ts";
import type { EditContext, PropertyBinding } from "./binding.ts";
import type {
  ElementChangeSet,
  ElementEditChangeInput,
  ElementEditProperty,
  ElementEditPropertyValue,
  ElementEditResult,
  ElementEditor,
  ElementEditorOptions,
  ElementEditorState,
} from "./types.ts";

interface ActiveEdit {
  element: Element;
  target: ElementSelection;
  bindings: Map<string, PropertyBinding>;
}

function idleState(): ElementEditorState {
  return { status: "idle", dirty: false, properties: [] };
}

function cloneSelection(selection: ElementSelection): ElementSelection {
  return { ...selection, classNames: [...selection.classNames] };
}

function cloneProperty(property: ElementEditProperty): ElementEditProperty {
  return property.schema.kind === "choice"
    ? { ...property, schema: { ...property.schema, options: [...property.schema.options] } }
    : { ...property, schema: { ...property.schema } };
}

function cloneState(state: ElementEditorState): ElementEditorState {
  if (state.status === "idle") return idleState();
  return {
    ...state,
    target: cloneSelection(state.target),
    properties: state.properties.map(cloneProperty),
  };
}

function sameValue(left: ElementEditPropertyValue, right: ElementEditPropertyValue): boolean {
  return Object.is(left, right);
}

function createContext(inspection: ElementInspection): EditContext {
  return {
    inspection,
    element: inspection.element,
    computedStyle: inspection.element.ownerDocument.defaultView?.getComputedStyle(
      inspection.element,
    ) ?? null,
  };
}

export function createElementEditor({
  onStateChange,
}: ElementEditorOptions = {}): ElementEditor {
  let active: ActiveEdit | null = null;
  let state: ElementEditorState = idleState();
  let destroyed = false;

  function emitState() {
    onStateChange?.(cloneState(state));
  }

  function resetState() {
    active = null;
    state = idleState();
  }

  function restoreActive() {
    if (!active) return;
    const bindings = [...active.bindings.values()].reverse();
    for (const binding of bindings) binding.restore();
  }

  function cancel() {
    if (!active) return;
    restoreActive();
    resetState();
    emitState();
  }

  function setTarget(inspection: ElementInspection | null) {
    if (destroyed) return;
    if (active) {
      restoreActive();
      resetState();
    }
    if (!inspection) {
      emitState();
      return;
    }

    const bindings = collectBindings(createContext(inspection), builtinPropertyAdapters);
    active = {
      element: inspection.element,
      target: cloneSelection(inspection.selection),
      bindings: new Map(bindings.map((binding) => [binding.property.id, binding])),
    };
    state = {
      status: "editing",
      target: cloneSelection(inspection.selection),
      dirty: false,
      properties: bindings.map((binding) => cloneProperty(binding.property)),
    };
    emitState();
  }

  function update(change: ElementEditChangeInput): ElementEditResult {
    if (!active || state.status !== "editing") return { ok: false, code: "no-target" };
    if ((active.element as Element & { isConnected?: boolean }).isConnected === false) {
      return { ok: false, code: "target-disconnected" };
    }

    const binding = active.bindings.get(change.property);
    if (!binding) return { ok: false, code: "unsupported-property" };
    const value = binding.normalize(change.value);
    if (value === null) return { ok: false, code: "invalid-value" };

    try {
      if (sameValue(value, binding.initialValue)) binding.restore();
      else binding.apply(value);
    } catch {
      return { ok: false, code: "apply-failed" };
    }

    binding.property = { ...binding.property, value };
    state = {
      ...state,
      dirty: [...active.bindings.values()].some(
        (candidate) => !sameValue(candidate.initialValue, candidate.property.value),
      ),
      properties: [...active.bindings.values()].map((candidate) =>
        cloneProperty(candidate.property),
      ),
    };
    emitState();
    return { ok: true };
  }

  function commit(): ElementChangeSet | null {
    if (!active || state.status !== "editing") return null;
    const changes = [...active.bindings.values()]
      .filter((binding) => !sameValue(binding.initialValue, binding.property.value))
      .map((binding) => ({
        property: binding.property.key,
        subject: binding.subject,
        before: binding.initialValue,
        after: binding.property.value,
      }));
    const changeSet = changes.length > 0
      ? { target: cloneSelection(active.target), changes }
      : null;
    resetState();
    emitState();
    return changeSet;
  }

  return {
    setTarget,
    getState() {
      return cloneState(state);
    },
    update,
    cancel,
    commit,
    destroy() {
      if (destroyed) return;
      restoreActive();
      resetState();
      destroyed = true;
    },
  };
}
