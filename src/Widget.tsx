import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChevronRight, Leaf, Sprout } from "lucide-react";

type Goal = { title: string; weekly: number; daily: number; startDate: string; };
const GOALS_KEY = "growth-greenhouse.goals";
const LANGUAGE_KEY = "growth-greenhouse.language";
type Language = "zh" | "en";
const text = (language: Language, zh: string, en: string) => language === "en" ? en : zh;

export default function Widget() {
  const [goal, setGoal] = useState<Goal | null>(null);
  const [language, setLanguage] = useState<Language>(() => localStorage.getItem(LANGUAGE_KEY) === "en" ? "en" : "zh");
  useEffect(() => {
    try { setGoal(JSON.parse(localStorage.getItem(GOALS_KEY) ?? "null")?.[0] ?? null); } catch { setGoal(null); }
    const updateLanguage = () => setLanguage(localStorage.getItem(LANGUAGE_KEY) === "en" ? "en" : "zh");
    window.addEventListener("storage", updateLanguage);
    return () => window.removeEventListener("storage", updateLanguage);
  }, []);
  return <div className="widget-card" onDoubleClick={() => void invoke("show_main_window")}>
    <div className="widget-icon"><Sprout size={18} /></div>
    <div className="widget-copy"><span>Growth Greenhouse</span><strong>{goal?.title ?? text(language, "还没有种下目标", "No goal planted yet")}</strong><small>{goal ? text(language, `每周 ${goal.weekly} 分钟 · 今天继续一点点`, `${goal.weekly} min per week · Keep growing today`) : text(language, "双击打开并种下第一个目标", "Double-click to plant your first goal")}</small></div>
    <button className="widget-open" onClick={() => void invoke("show_main_window")} aria-label={text(language, "打开 Growth Greenhouse", "Open Growth Greenhouse")}><ChevronRight size={17} /></button>
    <div className="widget-leaf"><Leaf size={14} /></div>
  </div>;
}
