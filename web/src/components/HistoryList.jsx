import {useEffect, useState} from 'react';

import {api} from '../api.js';

/**
 * 历史列表：展示「已斩」或「已掌握」的题目列表。
 * @param {string} kind 'slain' | 'mastered'。
 * @param {Function} onBack 返回错题集。
 */
export default function HistoryList({kind, onBack}) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');

  const isSlain = kind === 'slain';

  useEffect(() => {
    let cancelled = false;
    const load = isSlain ? api.slainList : api.masteredList;
    load()
        .then((data) => !cancelled && setItems(data.questions))
        .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [isSlain]);

  const title = isSlain ? '斩历史' : '已掌握';
  const emptyText = isSlain ?
      '还没有斩掉任何题。' :
      '还没有已掌握的题，继续刷题吧。';

  return (
    <div className="page">
      <header className="topbar">
        <button type="button" className="btn btn--link" onClick={onBack}>
          返回
        </button>
        <h1 className="topbar__title">{title}</h1>
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
            <p className="empty__text">{emptyText}</p>
          </div>
        )}

        {items && items.length > 0 && (
          <>
            <p className="card__hint">
              {`共 ${items.length} 道，仅显示最近 200 道。`}
            </p>
            <ul className="mistake-list">
              {items.map((item) => (
                <li key={item.id} className="card mistake-item">
                  <div className="question-meta">
                    <span className="badge">{`第${item.sourceNo}题`}</span>
                    {isSlain && (
                      <span className="badge badge--danger">已斩</span>
                    )}
                    {!isSlain && (
                      <span className="badge badge--good">已掌握</span>
                    )}
                  </div>
                  <p className="mistake-item__stem">{item.stem}</p>
                </li>
              ))}
            </ul>
          </>
        )}
      </main>
    </div>
  );
}
