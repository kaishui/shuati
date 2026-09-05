import {useEffect, useState} from 'react';

import {api} from '../api.js';

/** 错题集：未解决的错题列表，可重练或手动移出。 */
export default function Mistakes({onPractice, onBack}) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    api.mistakes()
        .then((data) => !cancelled && setItems(data.questions))
        .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, []);

  /** 手动移出错题集（「我会了」）。 */
  const remove = (id) => {
    api.resolveMistake(id)
        .then(() => setItems((prev) =>
          prev.filter((question) => question.id !== id)))
        .catch((err) => setError(err.message));
  };

  return (
    <div className="page">
      <header className="topbar">
        <button type="button" className="btn btn--link" onClick={onBack}>
          返回
        </button>
        <h1 className="topbar__title">错题集</h1>
        <div className="topbar__right">{items?.length ?? ''}</div>
      </header>

      <main className="page__body">
        {error && <div className="alert alert--error">{error}</div>}

        {!items && !error && (
          <div className="empty">
            <p className="empty__text">加载中…</p>
          </div>
        )}

        {items && items.length === 0 && (
          <div className="empty">
            <p className="empty__emoji">🎉</p>
            <p className="empty__text">错题集是空的，继续保持！</p>
          </div>
        )}

        {items && items.length > 0 && (
          <>
            <button
                type="button"
                className="btn btn--primary btn--block"
                onClick={() => onPractice(items.length)}>
              {`重练错题（${items.length} 题）`}
            </button>
            <ul className="mistake-list">
              {items.map((item) => (
                <li key={item.id} className="card mistake-item">
                  <div className="question-meta">
                    <span className="badge">{`第${item.sourceNo}题`}</span>
                    <span className="badge badge--danger">
                      {`错 ${item.wrongCount} 次`}
                    </span>
                  </div>
                  <p className="mistake-item__stem">{item.stem}</p>
                  <button
                      type="button"
                      className="btn btn--ghost btn--small"
                      onClick={() => remove(item.id)}>
                    我会了，移出错题集
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </main>
    </div>
  );
}
