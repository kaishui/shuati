import {useState} from 'react';

import Home from './components/Home.jsx';
import Mistakes from './components/Mistakes.jsx';
import Practice from './components/Practice.jsx';

/** 应用根组件：在首页、刷题、错题集三个视图间切换。 */
export default function App() {
  const [view, setView] = useState({name: 'home'});

  /**
   * 开始一轮刷题。
   * @param {number} count 题目数量。
   * @param {string} mode 练习模式。
   * @param {string} back 结束后返回的视图。
   */
  const startPractice = (count, mode, back) => {
    setView({name: 'practice', count, mode, back});
  };

  if (view.name === 'practice') {
    return (
      <Practice
          count={view.count}
          mode={view.mode}
          onExit={() => setView({name: view.back})} />
    );
  }

  if (view.name === 'mistakes') {
    return (
      <Mistakes
          onPractice={(count) => startPractice(count, 'mistakes', 'mistakes')}
          onBack={() => setView({name: 'home'})} />
    );
  }

  return (
    <Home
        onPractice={(count) => startPractice(count, 'practice', 'home')}
        onMistakes={() => setView({name: 'mistakes'})} />
  );
}
