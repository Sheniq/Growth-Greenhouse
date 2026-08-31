use rusqlite::Connection;
use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PatinaSource {
    available: bool,
    installed: bool,
    database_path: String,
    last_modified_ms: Option<i64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PatinaSession {
    id: i64,
    app_name: String,
    exe_name: String,
    start_time: i64,
    end_time: Option<i64>,
    duration_ms: Option<i64>,
}

fn default_database_path() -> PathBuf {
    std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
        .join("Patina")
        .join("patina.db")
}

fn selected_path(path: Option<String>) -> PathBuf {
    path.filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(default_database_path)
}

fn modified_ms(path: &Path) -> Option<i64> {
    path.metadata().ok()?.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok().map(|d| d.as_millis() as i64)
}

#[tauri::command]
fn get_patina_source(database_path: Option<String>) -> PatinaSource {
    let path = selected_path(database_path);
    let installed = std::env::var_os("LOCALAPPDATA")
        .map(|root| PathBuf::from(root).join("Patina").join("Patina.exe").is_file())
        .unwrap_or(false);
    PatinaSource {
        available: path.is_file(),
        installed,
        database_path: path.to_string_lossy().into_owned(),
        last_modified_ms: modified_ms(&path),
    }
}

#[tauri::command]
fn read_patina_sessions(
    since_ms: i64,
    until_ms: i64,
    database_path: Option<String>,
) -> Result<Vec<PatinaSession>, String> {
    let path = selected_path(database_path);
    if !path.is_file() {
        return Err(format!("没有找到 Patina 数据库：{}", path.display()));
    }
    let connection = Connection::open_with_flags(
        &path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY
            | rusqlite::OpenFlags::SQLITE_OPEN_URI,
    ).map_err(|error| format!("无法以只读方式打开 Patina：{error}"))?;
    let mut statement = connection.prepare(
        "SELECT id, app_name, exe_name, start_time, end_time, duration
         FROM sessions
         WHERE start_time < ?1 AND COALESCE(end_time, ?2) > ?3
         ORDER BY start_time ASC, id ASC",
    ).map_err(|error| format!("读取 Patina 会话结构失败：{error}"))?;
    let rows = statement.query_map([until_ms, until_ms, since_ms], |row| Ok(PatinaSession {
        id: row.get(0)?,
        app_name: row.get(1)?,
        exe_name: row.get(2)?,
        start_time: row.get(3)?,
        end_time: row.get(4)?,
        duration_ms: row.get(5)?,
    })).map_err(|error| format!("读取 Patina 会话失败：{error}"))?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|error| format!("解析 Patina 会话失败：{error}"))
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![get_patina_source, read_patina_sessions, show_main_window])
        .run(tauri::generate_context!())
        .expect("error while running Growth Greenhouse");
}

#[tauri::command]
fn show_main_window(app: tauri::AppHandle) -> Result<(), String> {
    let main = app.get_webview_window("main").ok_or_else(|| "主窗口不存在".to_string())?;
    main.show().map_err(|error| error.to_string())?;
    main.set_focus().map_err(|error| error.to_string())
}
