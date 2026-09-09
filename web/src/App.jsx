import {useState} from 'react';

import Home from './components/Home.jsx';
import Mistakes from './components/Mistakes.jsx';
import Practice from './components/Practice.jsx';
import SinglePractice from './components/SinglePractice.jsx';
import HistoryList from './components/HistoryList.jsx';

/** 应用根组件：在首页、刷题、错题集、单题练习、历史列表间切换。 */
export default function App() {
  const [view, setView] = useState({name: 'home'});

  /**
   * 开始一轮刷题。
   * @param {number} count 题目数量。
   * @param {string} mode 练习模式（practice/exam）。
   * @param {string} back 结束后返回的视图。
   * @param {boolean} endless 无限刷题模式（本轮不重复）。
   */
  const startPractice = (count, mode, back, endless = false) => {
    setView({name: 'practice', count, mode, back, endless});
  };

  if (view.name === 'practice') {
    return (
      <Practice
          count={view.count}
          mode={view.mode}
          endless={view.endless}
          onExit={() => setView({name: view.back})} />
    );
  }

  if (view.name === 'single') {
    return (
      <SinglePractice
          question={view.question}
          onDone={() => setView({name: 'mistakes'})}
          onExit={() => setView({name: 'mistakes'})} />
    );
  }

  if (view.name === 'history') {
    return (
      <HistoryList
          kind={view.kind}
          onBack={() => setView({name: 'mistakes'})} />
    );
  }

  if (view.name === 'mistakes') {
    return (
      <Mistakes
          onPractice={(count) => startPractice(count, 'mistakes', 'mistakes')}
          onSingle={(question) => setView({name: 'single', question})}
          onHistory={(kind) => setView({name: 'history', kind})}
          onBack={() => setView({name: 'home'})} />
    );
  }

  return (
    <Home
        onPractice={(count, endless, exam, fresh) =>
          startPractice(
              count, fresh ? 'fresh' : (exam ? 'exam' : 'practice'),
              'home', endless)}
        onMistakes={() => setView({name: 'mistakes'})} />
  );
}
