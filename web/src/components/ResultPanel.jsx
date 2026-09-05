/** 答题结果面板：判定 + 题干原文与答案片段证据。 */
export default function ResultPanel(
    {result, endless, onNext, onPrev, nextLabel, prevLabel}) {
  const verdictClass = result.correct ? ' result--correct' : ' result--wrong';
  return (
    <section className={`card result${verdictClass}`}>
      <div className="result__verdict">
        {result.correct ? '✓ 回答正确' : '✗ 回答错误'}
      </div>

      <dl className="result__lines">
        <div className="result__line">
          <dt className="result__dt">正确答案</dt>
          <dd className="result__dd">
            {`${result.answer} · ${result.answerText}`}
          </dd>
        </div>
        <div className="result__line">
          <dt className="result__dt">你的答案</dt>
          <dd className="result__dd">
            {`${result.selected} · ${result.selectedText}`}
          </dd>
        </div>
      </dl>

      <div className="evidence">
        <h3 className="evidence__title">答案解析证据</h3>
        <p className="evidence__label">原文题干</p>
        <blockquote className="evidence__quote">{result.stem}</blockquote>
        <p className="evidence__label">答案片段</p>
        <blockquote className="evidence__quote">
          {`${result.answer}、${result.answerText}`}
        </blockquote>
      </div>

      {result.mistakeUpdated && (
        <p className="result__note">
          {endless ?
              '已加入错题集。' :
              '已加入错题集，本题稍后会再次出现。'}
        </p>
      )}
      {result.mistakeAdvanced && (
        <p className="result__note result__note--info">
          {`答对 ${result.correctStreak}/2 次：隔天再答对一次即可移出错题集`}
        </p>
      )}
      {result.mistakeResolved && (
        <p className="result__note result__note--good">
          隔天答对 2 次，已移出错题集 🎉
        </p>
      )}

      <div className="summary__actions">
        {onNext && (
          <button
              type="button"
              className="btn btn--primary btn--block"
              onClick={onNext}>
            {nextLabel ?? '下一题'}
          </button>
        )}
        {onPrev && (
          <button
              type="button"
              className="btn btn--ghost btn--block"
              onClick={onPrev}>
            {prevLabel ?? '上一题'}
          </button>
        )}
      </div>
    </section>
  );
}
