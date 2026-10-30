import { useEffect, useState } from 'react';
import { call } from '../shared/lib/client';
import { noticeMessage } from '../shared/lib/call-error';
import { dismissSplash } from '../shared/lib/splash';
import type { State } from '../shared/workbench';

// 开场与引导：首次启动的开场画面、紧接其后的功能引导，以及启动动画何时收起。
export function useOnboarding({ state, ready, error, isCollapsed, expand, setError }: { state: State; ready: boolean; error: string; isCollapsed: boolean; expand: () => void; setError: (message: string) => void }) {
  // 界面就绪或加载出错时收起启动动画，出错时要让错误提示露出来。
  // 首次启动在界面就绪后显示开场画面；点击「开始探索」后记入偏好，以后只显示简短的加载动画。
  // 设置里的「重新播放」只当场再看一次，不改动已保存的偏好。
  const [introDone, setIntroDone] = useState(false);
  const [introReplay, setIntroReplay] = useState(false);
  useEffect(() => {
    const replay = () => setIntroReplay(true);
    window.addEventListener('workbench-show-intro', replay);
    return () => window.removeEventListener('workbench-show-intro', replay);
  }, []);
  const showIntro = ready && !error && ((!state.preferences.introSeen && !introDone) || introReplay);
  const finishIntro = () => {
    setIntroReplay(false);
    if (state.preferences.introSeen || introDone) return;
    setIntroDone(true);
    void call('preferences.save', { ...state.preferences, introSeen: true }).catch(e => setError(noticeMessage(e)));
  };
  // 功能引导紧接开场画面出现，看完或跳过后记入偏好；设置里的「重新查看」只当场再看一次。
  const [tourDone, setTourDone] = useState(false);
  const [tourReplay, setTourReplay] = useState(false);
  useEffect(() => {
    const replay = () => setTourReplay(true);
    window.addEventListener('workbench-show-tour', replay);
    return () => window.removeEventListener('workbench-show-tour', replay);
  }, []);
  const showTour = ready && !error && !showIntro && ((!state.preferences.tourSeen && !tourDone) || tourReplay);
  // 引导高亮侧栏入口，侧栏收起时先展开。
  useEffect(() => { if (showTour && isCollapsed) expand(); }, [showTour, isCollapsed, expand]);
  const finishTour = () => {
    setTourReplay(false);
    if (state.preferences.tourSeen || tourDone) return;
    setTourDone(true);
    // 开场画面刚保存的 introSeen 可能还没回到状态里，一并带上，避免被覆盖。
    void call('preferences.save', { ...state.preferences, introSeen: state.preferences.introSeen || introDone, tourSeen: true }).catch(e => setError(noticeMessage(e)));
  };
  // 界面就绪或加载出错时收起启动动画，出错时要让错误提示露出来；开场画面与启动动画同一造型，直接接续。
  // 开场画面按需加载：等它的代码到位再收起启动动画，避免先露出一帧主界面。
  useEffect(() => {
    if (error) dismissSplash(true);
    else if (showIntro) void import('./intro-screen').then(() => dismissSplash(true));
    else if (ready) dismissSplash();
  }, [ready, error, showIntro]);
  return { showIntro, finishIntro, showTour, finishTour };
}
