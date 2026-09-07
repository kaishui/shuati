import {useEffect, useState} from 'react';

import {api} from '../api.js';

/** 错题集：未解决的错题列表，可点击重做、重练或手动移出/斩掉。 */
export default function Mistakes({onPractice, onSingle, onHistory, onBack}) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');

  const load = () => {
    let cancelled = false;
    api.mistakes()
        .then((data) => !cancelled && setItems(data.questions))
        .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  };

  useEffect(load, []);

  /** 手动移出错题集（「我会了」）。 */
  const remove = (id) => {
    api.resolveMistake(id)
        .then(() => setItems((prev) =>
          prev.filter((question) => question.id !== id)))
        .catch((err) => setError(err.message));
  };

  /** 「斩」掉本题：不再出现并移出错题集。 */
  const slay = (id) => {
    api.slay(id)
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

        {/* 重练按钮不依赖列表加载完成，进入页面即可开练。 */}
        {(!items || items.length > 0) && (
          <button
              type="button"
              className="btn btn--primary btn--block"
              onClick={() => onPractice(items?.length ?? 10)}>
            {items ? `重练错题（${items.length} 题）` : '重练错题'}
          </button>
        )}

        {/* 历史入口：已斩 / 已掌握。 */}
        <div className="btn-row">
          <button
              type="button"
              className="btn btn--ghost"
              onClick={() => onHistory('mastered')}>
            已掌握
          </button>
          <button
              type="button"
              className="btn btn--ghost"
              onClick={() => onHistory('slain')}>
            斩历史
          </button>
        </div>

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
            <p className="card__hint" style={{marginTop: 12}}>
              点击题目可重做一次，答对即移出错题集。
            </p>
            <ul className="mistake-list">
              {items.map((item) => (
                <li key={item.id} className="card mistake-item">
                  <button
                      type="button"
                      className="mistake-item__main"
                      onClick={() => onSingle(item)}>
                    <div className="question-meta">
                      <span className="badge">{`第${item.sourceNo}题`}</span>
                      <span className="badge badge--danger">
                        {`错 ${item.wrongCount} 次`}
                      </span>
                      {item.correctStreak > 0 && (
                        <span className="badge badge--good">
                          {`答对 ${item.correctStreak}/2`}
                        </span>
                      )}
                    </div>
                    <p className="mistake-item__stem">{item.stem}</p>
                  </button>
                  <div className="mistake-item__actions">
                    <button
                        type="button"
                        className="btn btn--ghost btn--small"
                        onClick={() => remove(item.id)}>
                      我会了，移出
                    </button>
                    <button
                        type="button"
                        className="btn btn--ghost btn--small btn--danger"
                        onClick={() => slay(item.id)}>
                      斩
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </main>
    </div>
  );
}
