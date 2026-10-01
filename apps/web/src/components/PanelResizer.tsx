import type { Workbench } from "../hooks/use-workbench";
import {
  MIN_CHAT_WIDTH,
  MAX_CHAT_WIDTH,
  DEFAULT_CHAT_WIDTH,
} from "../hooks/use-panel-resize";

type Props = Pick<
  Workbench,
  "chatWidth" | "setIsResizing" | "setChatWidth" | "resizeWithKeyboard"
>;

export function PanelResizer(props: Props) {
  const { chatWidth, setIsResizing, setChatWidth, resizeWithKeyboard } = props;

  return (
    <div
      className="panel-resizer"
      role="separator"
      aria-label="调整对话与预览区域宽度"
      aria-orientation="vertical"
      aria-valuemin={MIN_CHAT_WIDTH}
      aria-valuemax={MAX_CHAT_WIDTH}
      aria-valuenow={Math.round(chatWidth)}
      tabIndex={0}
      title="拖动调整宽度 · 双击复位"
      onPointerDown={(event) => {
        event.preventDefault();
        setIsResizing(true);
      }}
      onDoubleClick={() => setChatWidth(DEFAULT_CHAT_WIDTH)}
      onKeyDown={resizeWithKeyboard}
    >
      <span />
    </div>
  );
}
