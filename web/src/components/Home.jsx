import {useEffect, useState} from 'react';

import {api} from '../api.js';

/** 刷题轮次选项：固定题数 + 无限模式（本轮不重复）。 */
const ROUND_MODES = [
  {key: '10', label: '10 题', count: 10},
  {key: '20', label: '20 题', count: 20},
  {key: '50', label: '50 题', count: 50},
  {key: 'endless', label: '无限', count: 10, endless: true},
];

/** 统计卡片：数值 + 标签。 */
function StatCard({value, label, accent}) {
  return (
    <div className={`stat-card${accent ? ' stat-card--accent' : ''}`}>
      <div className="stat-card__value">{value}</div>
      <div className="stat-card__label">{label}</div>
    </div>
  );
}

/** 首页：统计概览 + 模式入口。 */
export default function Home({onPractice, onMistakes}) {
  const [stats, setStats] = useState(null);
  const [modeKey, setModeKey] = useState(ROUND_MODES[0].key);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    api.stats()
        .then((data) => !cancelled && setStats(data))
        .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="page">
      <header className="topbar">
        <h1 className="topbar__title">检验专业刷题</h1>
      </header>

      <main className="page__body">
        {error && <div className="alert alert--error">{error}</div>}

        <section className="card">
          <div className="stats-grid">
            <StatCard value={stats?.questions ?? '-'} label="题库总量" />
            <StatCard value={stats?.attempts ?? '-'} label="累计作答" />
            <StatCard value={stats?.correct ?? '-'} label="累计答对" />
            <StatCard value={stats?.mistakes ?? '-'} label="待练错题"
                accent />
          </div>
        </section>

        <section className="card">
          <h2 className="card__title">开始刷题</h2>
          <p className="card__hint">
            点击选项直接作答，答对自动跳下一题；答错的题会重新排队
            再次出现，隔天答对两次后移出错题集。
          </p>
          <div className="chip-row">
            {ROUND_MODES.map((option) => (
              <button
                  key={option.key}
                  type="button"
                  className={`chip${
                    modeKey === option.key ? ' chip--active' : ''
                  }`}
                  onClick={() => setModeKey(option.key)}>
                {option.label}
              </button>
            ))}
          </div>
          <button
              type="button"
              className="btn btn--primary btn--block"
              onClick={() => {
                const option = ROUND_MODES.find(
                    (item) => item.key === modeKey);
                onPractice(option.count, option.endless);
              }}>
            开始刷题
          </button>
        </section>

        <section className="card">
          <button
              type="button"
              className="btn btn--ghost btn--block"
              onClick={onMistakes}>
            错题集{stats?.mistakes ? `（${stats.mistakes}）` : ''}
          </button>
        </section>
      </main>
    </div>
  );
}
