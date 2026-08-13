import type { RankingPrompt } from "../../core/ranking-session";

interface RankingDialogProps {
  readonly prompt: Extract<RankingPrompt, { type: "compare" }>;
  readonly onAnswer: (better: boolean) => void;
}

export function RankingDialog({ prompt, onAnswer }: RankingDialogProps) {
  return (
    <div className="overlay">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <h2 id="modal-title">Which is better?</h2>
        <p className="prompt-question">Pick the one you liked more.</p>
        <div className="choices">
          <button
            className="compare-card"
            type="button"
            onClick={() => onAnswer(true)}
          >
            {prompt.item.title}
          </button>
          <span className="compare-vs">vs</span>
          <button
            className="compare-card"
            type="button"
            onClick={() => onAnswer(false)}
          >
            {prompt.against.title}
          </button>
        </div>
      </div>
    </div>
  );
}
