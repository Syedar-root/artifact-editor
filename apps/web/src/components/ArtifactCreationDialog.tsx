import type { Workbench } from "../hooks/use-workbench";
import { useEffect, useRef } from "react";
import { X, Check, RefreshCw } from "lucide-react";
import {
  TECHNOLOGY_OPTIONS,
  ARTIFACT_CREATION_STEPS,
  artifactCreationStepState,
} from "../artifact-config";

type Props = Pick<
  Workbench,
  | "creatingArtifact"
  | "setArtifactDialogOpen"
  | "createNewArtifact"
  | "artifactDraftName"
  | "setArtifactDraftName"
  | "artifactDraftStack"
  | "setArtifactDraftStack"
  | "artifactCreationPhase"
  | "artifactCreationError"
>;

export function ArtifactCreationDialog(props: Props) {
  const {
    creatingArtifact,
    setArtifactDialogOpen,
    createNewArtifact,
    artifactDraftName,
    setArtifactDraftName,
    artifactDraftStack,
    setArtifactDraftStack,
    artifactCreationPhase,
    artifactCreationError,
  } = props;
  const dialogRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    return () => {
      const target = previousFocus?.isConnected
        ? previousFocus
        : document.querySelector<HTMLButtonElement>(".project-switcher");
      target?.focus();
    };
  }, []);

  return (
    <div
      className="artifact-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !creatingArtifact) {
          setArtifactDialogOpen(false);
        }
      }}
    >
      <form
        className="artifact-dialog"
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="artifact-dialog-title"
        onSubmit={createNewArtifact}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !creatingArtifact) {
            event.preventDefault();
            setArtifactDialogOpen(false);
          }
          if (event.key !== "Tab") return;
          const focusable = Array.from(
            dialogRef.current?.querySelectorAll<HTMLElement>(
              'button:not(:disabled), input:not(:disabled):not([type="radio"]), input[type="radio"]:checked:not(:disabled)',
            ) ?? [],
          );
          const first = focusable[0];
          const last = focusable.at(-1);
          if (!first) {
            event.preventDefault();
            dialogRef.current?.focus();
          } else if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        <div className="artifact-dialog-heading">
          <div>
            <h2 id="artifact-dialog-title">创建产物</h2>
          </div>
          <button
            type="button"
            aria-label="关闭"
            disabled={creatingArtifact}
            onClick={() => setArtifactDialogOpen(false)}
          >
            <X size={17} />
          </button>
        </div>

        <label className="artifact-field">
          <span>产物名称</span>
          <input
            autoFocus
            required
            maxLength={80}
            disabled={creatingArtifact}
            value={artifactDraftName}
            placeholder="为你的创作命名"
            onChange={(event) => setArtifactDraftName(event.target.value)}
          />
        </label>

        <fieldset className="technology-options">
          <legend>技术栈</legend>
          {TECHNOLOGY_OPTIONS.map((option) => (
            <label
              className={
                artifactDraftStack === option.value ? "is-selected" : ""
              }
              key={option.value}
            >
              <input
                type="radio"
                name="technology-stack"
                value={option.value}
                disabled={creatingArtifact}
                checked={artifactDraftStack === option.value}
                onChange={() => setArtifactDraftStack(option.value)}
              />
              <span>
                <strong>{option.label}</strong>
              </span>
              <i aria-hidden="true" />
            </label>
          ))}
        </fieldset>

        {artifactCreationPhase !== "idle" && (
          <section className="artifact-creation-progress" aria-live="polite">
            <div className="artifact-creation-progress-heading">
              <span>
                {artifactCreationPhase === "ready"
                  ? "创建完成"
                  : artifactCreationError
                    ? "创建遇到问题"
                    : "正在准备产物"}
              </span>
            </div>
            <ol>
              {ARTIFACT_CREATION_STEPS.map((step, index) => {
                const status = artifactCreationStepState(
                  artifactCreationPhase,
                  step.phase,
                  Boolean(artifactCreationError),
                );
                return (
                  <li className={`is-${status}`} key={step.phase}>
                    <span className="artifact-creation-step-marker">
                      {status === "complete" ||
                      artifactCreationPhase === "ready" ? (
                        <Check size={13} />
                      ) : status === "error" ? (
                        <X size={13} />
                      ) : status === "active" ? (
                        <RefreshCw className="spin" size={13} />
                      ) : (
                        index + 1
                      )}
                    </span>
                    <span>
                      <strong>{step.label}</strong>
                    </span>
                  </li>
                );
              })}
            </ol>
            {artifactCreationError && <p>{artifactCreationError}</p>}
          </section>
        )}

        <div className="artifact-dialog-actions">
          <button
            type="button"
            disabled={creatingArtifact}
            onClick={() => setArtifactDialogOpen(false)}
          >
            取消
          </button>
          <button
            type="submit"
            disabled={creatingArtifact || !artifactDraftName.trim()}
          >
            {creatingArtifact
              ? "正在创建…"
              : artifactCreationError
                ? "重新创建"
                : "创建并启动"}
          </button>
        </div>
      </form>
    </div>
  );
}
