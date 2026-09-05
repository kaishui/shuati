import {useEffect, useState} from 'react';

import {api} from '../api.js';
import ResultPanel from './ResultPanel.jsx';

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
        答错的题已进入错题集，下次刷题会优先出现。
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
export default function Practice({count, mode, onExit}) {
  const [round, setRound] = useState(0);
  const [queue, setQueue] = useState([]);
  const [current, setCurrent] = useState(null);
  const [selected, setSelected] = useState('');
  const [result, setResult] = useState(null);
  const [phase, setPhase] = useState('loading');
  const [submitting, setSubmitting] = useState(false);
  const [roundStats, setRoundStats] = useState({correct: 0, wrong: 0});
  const [error, setError] = useState('');

  // 拉取一轮题目（错题优先）；round 变化时重新拉取。
  useEffect(() => {
    let cancelled = false;
    api.practice(count, mode)
        .then(({questions}) => {
          if (cancelled) return;
          const [head, ...rest] = questions;
          setCurrent(head ?? null);
          setQueue(rest);
          setSelected('');
          setResult(null);
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
   * 点击选项：选中并立即提交。
   * 答错的题重新排到队尾，稍后再次出现。
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
      setRoundStats((prev) => ({
        correct: prev.correct + (res.correct ? 1 : 0),
        wrong: prev.wrong + (res.correct ? 0 : 1),
      }));
      if (!res.correct) {
        setQueue((prev) => [...prev, {...current, requeued: true}]);
      }
    } catch (err) {
      // 提交失败保持作答态，可重新点选重试。
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  /** 进入下一题；队列耗尽则展示本轮小结。 */
  const next = () => {
    const [head, ...rest] = queue;
    setSelected('');
    setResult(null);
    setCurrent(head ?? null);
    setQueue(rest);
    setPhase(head ? 'answering' : 'summary');
  };

  /** 按作答状态计算选项样式。 */
  const optionClass = (option) => {
    let state = '';
    if (phase === 'result') {
      if (option.key === result.answer) state = ' option--correct';
      else if (option.key === selected && !result.correct) {
        state = ' option--wrong';
      }
    }
    const selectedClass =
        option.key === selected ? ' option--selected' : '';
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
          {mode === 'mistakes' ? '错题重练' : '刷题模式'}
        </h1>
        <div className="topbar__right">
          {`对 ${roundStats.correct} · 错 ${roundStats.wrong}`}
        </div>
      </header>

      <div className="progress">
        <div
            className="progress__bar"
            style={{width: `${progress}%`}} />
      </div>

      <main className="page__body">
        {error && <div className="alert alert--error">{error}</div>}

        {phase === 'summary' && (
          <SummaryPanel
              stats={roundStats}
              onRestart={restart}
              onExit={onExit} />
        )}

        {current && phase !== 'summary' && (
          <>
            <section className="card">
              <div className="question-meta">
                <span className="badge">{`第${current.sourceNo}题`}</span>
                {current.requeued && (
                  <span className="badge badge--danger">错题重做</span>
                )}
                {current.wrongCount > 0 && !current.requeued && (
                  <span className="badge badge--danger">
                    {`错题 · 错 ${current.wrongCount} 次`}
                  </span>
                )}
              </div>
              <h2 className="stem">{current.stem}</h2>
              <p className="card__hint">点击选项即提交答案</p>
            </section>

            <section className="options">
              {current.options.map((option) => (
                <button
                    key={option.key}
                    type="button"
                    className={optionClass(option)}
                    disabled={phase !== 'answering' || submitting}
                    onClick={() => choose(option.key)}>
                  <span className="option__key">{option.key}</span>
                  <span className="option__text">{option.text}</span>
                </button>
              ))}
            </section>

            {phase === 'result' && (
              <ResultPanel result={result} onNext={next} />
            )}
          </>
        )}
      </main>
    </div>
  );
}
