import {useState} from 'react';

import {api} from '../api.js';
import ResultPanel from './ResultPanel.jsx';

/**
 * 单题练习：对一道指定题目重新作答（错题集点击进入）。
 * @param {Object} question 题目对象（含 id/stem/options/sourceNo）。
 * @param {Function} onDone 作答完成后的回调（返回错题集并刷新）。
 * @param {Function} onExit 直接返回（不刷新）。
 */
export default function SinglePractice({question, onDone, onExit}) {
  const [selected, setSelected] = useState('');
  const [result, setResult] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  /** 点击选项：选中并提交。 */
  const choose = async (key) => {
    if (submitting || result) return;
    setSelected(key);
    setSubmitting(true);
    try {
      const res = await api.answer({
        questionId: question.id, selected: key, mode: 'mistakes',
      });
      setResult(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const optionClass = (option) => {
    let state = '';
    if (result) {
      if (option.key === result.answer) state = ' option--correct';
      else if (option.key === selected && !result.correct) {
        state = ' option--wrong';
      }
    }
    const selectedClass =
        option.key === selected ? ' option--selected' : '';
    return `option${selectedClass}${state}`;
  };

  return (
    <div className="page">
      <header className="topbar">
        <button type="button" className="btn btn--link" onClick={onExit}>
          返回
        </button>
        <h1 className="topbar__title">再做一次</h1>
        <div className="topbar__right" />
      </header>

      <main className="page__body">
        {error && <div className="alert alert--error">{error}</div>}

        <section className="card">
          <div className="question-meta">
            <span className="badge">{`第${question.sourceNo}题`}</span>
            {question.wrongCount > 0 && (
              <span className="badge badge--danger">
                {`错 ${question.wrongCount} 次`}
              </span>
            )}
          </div>
          <h2 className="stem">{question.stem}</h2>
          <p className="card__hint">重新作答本题，答对即移出错题集。</p>
        </section>

        <section className="options">
          {question.options.map((option) => (
            <button
                key={option.key}
                type="button"
                className={optionClass(option)}
                disabled={submitting || !!result}
                onClick={() => choose(option.key)}>
              <span className="option__key">{option.key}</span>
              <span className="option__text">{option.text}</span>
            </button>
          ))}
        </section>

        {result && (
          <ResultPanel
              result={result}
              endless={false}
              onNext={onDone}
              nextLabel="完成，返回错题集" />
        )}
      </main>
    </div>
  );
}
