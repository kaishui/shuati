import {useEffect, useRef, useState} from 'react';

import {api} from '../api.js';
import ResultPanel from './ResultPanel.jsx';

/** 答对后自动跳下一题的延迟。 */
const AUTO_NEXT_DELAY_MS = 1500;

/** 无限模式：队列剩 2 题时自动补充。 */
const TOP_UP_THRESHOLD = 2;

/** 无限模式每次补充的题数。 */
const TOP_UP_COUNT = 5;

/** 本轮小结。 */
function SummaryPanel({stats, onRestart, onExit}) {
  const total = stats.correct + stats.wrong;
  const accuracy = total ? Math.round((stats.correct / total) * 100) : 0;
  return (
    <section className="card summary">
      <p className="summary__emoji">{accuracy >= 80 ? '🎉' : '💪'}</p>
      <h2 className="summary__title">本轮完成</h2>
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-card__value">{total}</div>
          <div className="stat-card__label">作答</div>
        </div>
        <div className="stat-card">
          <div className="stat-card__value">{stats.correct}</div>
          <div className="stat-card__label">答对</div>
        </div>
        <div className="stat-card">
          <div className="stat-card__value">{stats.wrong}</div>
          <div className="stat-card__label">答错</div>
        </div>
        <div className="stat-card stat-card--accent">
          <div className="stat-card__value">{accuracy}%</div>
          <div className="stat-card__label">正确率</div>
        </div>
      </div>
      <p className="summary__hint">
        答错的题已进入错题集，之后每轮会动态抽取巩固。
      </p>
      <div className="summary__actions">
        <button type="button" className="btn btn--primary btn--block"
            onClick={onRestart}>
          再练一轮
        </button>
        <button type="button" className="btn btn--ghost btn--block"
            onClick={onExit}>
          返回
        </button>
      </div>
    </section>
  );
}

/** 刷题主界面：出题、作答、展示答案证据、错题重排。 */
export default function Practice({count, mode, endless, onExit}) {
  const [round, setRound] = useState(0);
  const [queue, setQueue] = useState([]);
  const [current, setCurrent] = useState(null);
  const [selected, setSelected] = useState('');
  const [result, setResult] = useState(null);
  const [phase, setPhase] = useState('loading');
  const [submitting, setSubmitting] = useState(false);
  const [roundStats, setRoundStats] = useState({correct: 0, wrong: 0});
  const [error, setError] = useState('');
  // 作答历史（题目 + 判定结果），用于「上一题」回看详情。
  const [history, setHistory] = useState([]);
  // 正在回看的题在 history 中的下标；null 表示未回看。
  const [reviewIndex, setReviewIndex] = useState(null);
  // 本轮已出过的题目 id（无限模式不重复）。
  const [seenIds, setSeenIds] = useState([]);
  const autoNextTimer = useRef(null);
  const toppingUp = useRef(false);

  // 考试模式：固定题数、全部随机、答错不重排（同无限模式）。
  const noRequeue = endless || mode === 'exam';

  // 卸载时清理自动跳题定时器。
  useEffect(() => () => clearTimeout(autoNextTimer.current), []);

  // 拉取一轮题目（错题优先）；round 变化时重新拉取。
  useEffect(() => {
    let cancelled = false;
    api.practice(count, mode)
        .then(({questions}) => {
          if (cancelled) return;
          const [head, ...rest] = questions;
          setCurrent(head ?? null);
          setQueue(rest);
          setSeenIds(questions.map((question) => question.id));
          setSelected('');
          setResult(null);
          setHistory([]);
          setReviewIndex(null);
          setRoundStats({correct: 0, wrong: 0});
          setPhase(head ? 'answering' : 'summary');
        })
        .catch((err) => {
          if (cancelled) return;
          setError(err.message);
          setPhase('error');
        });
    return () => {
      cancelled = true;
    };
  }, [round, count, mode]);

  /** 再练一轮：重置状态并重新拉题。 */
  const restart = () => {
    setError('');
    setPhase('loading');
    setRound((prev) => prev + 1);
  };

  /**
   * 无限模式：队列不足时补充新题（排除本轮已出过的题）。
   * @param {boolean} needsHead 当前无题展示，需补足后立即取第一题。
   */
  const topUp = async (needsHead) => {
    if (toppingUp.current) return;
    toppingUp.current = true;
    try {
      const exclude = [...seenIds, ...queue.map((question) => question.id)];
      if (current) exclude.push(current.id);
      const {questions} = await api.practice(TOP_UP_COUNT, mode, exclude);
      setSeenIds((prev) =>
        [...prev, ...questions.map((question) => question.id)]);
      if (needsHead) {
        const [head, ...rest] = questions;
        setCurrent(head ?? null);
        setQueue(rest);
        setPhase(head ? 'answering' : 'summary');
      } else {
        setQueue((prev) => [...prev, ...questions]);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      toppingUp.current = false;
    }
  };

  /** 进入下一题；队列耗尽则小结（无限模式自动补充）。 */
  const next = () => {
    clearTimeout(autoNextTimer.current);
    const [head, ...rest] = queue;
    setSelected('');
    setResult(null);
    setCurrent(head ?? null);
    setQueue(rest);
    if (head) {
      setPhase('answering');
      if (endless && rest.length <= TOP_UP_THRESHOLD) topUp(false);
    } else if (endless) {
      setPhase('loading');
      topUp(true);
    } else {
      setPhase('summary');
    }
  };

  /**
   * 点击选项：选中并立即提交。
   * 答错重新排到队尾稍后重做（无限模式不重排）；答对自动跳下一题。
   * @param {string} key 选项字母。
   */
  const choose = async (key) => {
    if (phase !== 'answering' || submitting || !current) return;
    setSelected(key);
    setSubmitting(true);
    try {
      const res = await api.answer({
        questionId: current.id, selected: key, mode,
      });
      setResult(res);
      setPhase('result');
      setHistory((prev) => [...prev, {question: current, result: res}]);
      setRoundStats((prev) => ({
        correct: prev.correct + (res.correct ? 1 : 0),
        wrong: prev.wrong + (res.correct ? 0 : 1),
      }));
      if (!res.correct) {
        if (!noRequeue) {
          setQueue((prev) => [...prev, {...current, requeued: true}]);
        }
      } else {
        autoNextTimer.current = setTimeout(next, AUTO_NEXT_DELAY_MS);
      }
    } catch (err) {
      // 提交失败保持作答态，可重新点选重试。
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  /** 回看上一题（当前题已入历史，取倒数第二项）。 */
  const viewPrevious = () => {
    clearTimeout(autoNextTimer.current);
    setReviewIndex(history.length - 2);
  };

  /** 退出回看，回到当前结果面板。 */
  const exitReview = () => setReviewIndex(null);

  /** 回看中继续往前翻。 */
  const stepBackReview = () => {
    setReviewIndex((prev) => Math.max(0, prev - 1));
  };

  const reviewing = reviewIndex !== null ? history[reviewIndex] : null;
  const displayQuestion = reviewing ? reviewing.question : current;
  const displayResult = reviewing ? reviewing.result : result;
  const displaySelected = reviewing ? reviewing.result.selected : selected;
  const displayPhase = reviewing ? 'result' : phase;

  const resultOnNext = reviewing ? exitReview : next;
  const resultOnPrev = reviewing ?
      (reviewIndex > 0 ? stepBackReview : null) :
      (history.length >= 2 ? viewPrevious : null);

  /** 按作答状态计算选项样式。 */
  const optionClass = (option) => {
    let state = '';
    if (displayPhase === 'result') {
      if (option.key === displayResult.answer) state = ' option--correct';
      else if (option.key === displaySelected && !displayResult.correct) {
        state = ' option--wrong';
      }
    }
    const selectedClass =
        option.key === displaySelected ? ' option--selected' : '';
    return `option${selectedClass}${state}`;
  };

  const done = roundStats.correct + roundStats.wrong;
  const remaining = queue.length + (current ? 1 : 0);
  const progress = done + remaining ? (done / (done + remaining)) * 100 : 0;

  if (phase === 'error') {
    return (
      <div className="page">
        <main className="page__body">
          <div className="alert alert--error">
            {error || '加载失败'}
          </div>
          <button type="button" className="btn btn--ghost btn--block"
              onClick={onExit}>
            返回
          </button>
        </main>
      </div>
    );
  }

  return (
    <div className="page page--practice">
      <header className="topbar">
        <button type="button" className="btn btn--link" onClick={onExit}>
          退出
        </button>
        <h1 className="topbar__title">
          {mode === 'mistakes' ?
              '错题重练' :
              (mode === 'exam' ? '考试模式' :
                  (mode === 'fresh' ? '只做新题' :
                      (endless ? '无限刷题' : '刷题模式')))}
        </h1>
        <div className="topbar__right">
          {`对 ${roundStats.correct} · 错 ${roundStats.wrong}`}
        </div>
      </header>

      {!endless && (
        <div className="progress">
          <div
              className="progress__bar"
              style={{width: `${progress}%`}} />
        </div>
      )}

      <main className="page__body">
        {error && <div className="alert alert--error">{error}</div>}

        {phase === 'summary' && !displayQuestion && (
          <SummaryPanel
              stats={roundStats}
              onRestart={restart}
              onExit={onExit} />
        )}

        {displayQuestion && (
          <>
            {reviewing && (
              <div className="alert alert--info">正在回看已作答的题目</div>
            )}

            <section className="card">
              <div className="question-meta">
                <span className="badge">{`第${displayQuestion.sourceNo}题`}</span>
                {displayQuestion.requeued && (
                  <span className="badge badge--danger">错题重做</span>
                )}
                {displayQuestion.wrongCount > 0 &&
                    !displayQuestion.requeued && (
                  <span className="badge badge--danger">
                    {`错题 · 错 ${displayQuestion.wrongCount} 次`}
                  </span>
                )}
              </div>
              <h2 className="stem">{displayQuestion.stem}</h2>
              {!reviewing && (
                <p className="card__hint">
                  {endless ?
                      '点击选项即提交，答对自动下一题，本轮不重复' :
                      (mode === 'exam' ?
                          '考试模式：全部随机，答对自动下一题' :
                          (mode === 'fresh' ?
                              '只做没做过的题，答错重排到队尾直到答对' :
                              '点击选项即提交答案，答对自动跳下一题'))}
                </p>
              )}
            </section>

            <section className="options">
              {displayQuestion.options.map((option) => (
                <button
                    key={option.key}
                    type="button"
                    className={optionClass(option)}
                    disabled={displayPhase !== 'answering' || submitting}
                    onClick={() => choose(option.key)}>
                  <span className="option__key">{option.key}</span>
                  <span className="option__text">{option.text}</span>
                </button>
              ))}
            </section>

            {displayPhase === 'result' && (
              <ResultPanel
                  result={displayResult}
                  endless={endless}
                  onNext={resultOnNext}
                  nextLabel={reviewing ? '返回' : '下一题'}
                  onPrev={resultOnPrev}
                  prevLabel={reviewing ? '再上一题' : '上一题'} />
            )}
          </>
        )}
      </main>
    </div>
  );
}
