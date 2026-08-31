import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChevronRight, Leaf, Sprout } from "lucide-react";

type Goal = { title: string; weekly: number; daily: number; startDate: string; };
const GOALS_KEY = "growth-greenhouse.goals";

export default function Widget() {
  const [goal, setGoal] = useState<Goal | null>(null);
  useEffect(() => {
    try { setGoal(JSON.parse(localStorage.getItem(GOALS_KEY) ?? "null")?.[0] ?? null); } catch { setGoal(null); }
  }, []);
  return <div className="widget-card" onDoubleClick={() => void invoke("show_main_window")}>
    <div className="widget-icon"><Sprout size={18} /></div>
    <div className="widget-copy"><span>Growth Greenhouse</span><strong>{goal?.title ?? "还没有种下目标"}</strong><small>{goal ? `每周 ${goal.weekly} 分钟 · 今天继续一点点` : "双击打开并种下第一个目标"}</small></div>
    <button className="widget-open" onClick={() => void invoke("show_main_window")} aria-label="打开 Growth Greenhouse"><ChevronRight size={17} /></button>
    <div className="widget-leaf"><Leaf size={14} /></div>
  </div>;
}
