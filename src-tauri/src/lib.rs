// SPDX-License-Identifier: GPL-3.0-or-later
use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::Duration;

/// One RCON command against one target: auth, exec, first response body.
/// The password arrives per call from the frontend and is never stored here.
#[tauri::command]
fn rcon_exec(host: String, port: u16, password: String, command: String) -> Result<String, String> {
    let mut stream = TcpStream::connect((host.as_str(), port)).map_err(|e| e.to_string())?;
    stream
        .set_read_timeout(Some(Duration::from_secs(10)))
        .map_err(|e| e.to_string())?;

    write_packet(&mut stream, 1, 3, &password).map_err(|e| e.to_string())?;
    let (auth_id, _, _) = read_packet(&mut stream).map_err(|e| e.to_string())?;
    if auth_id == -1 {
        return Err("RCON authentication refused".into());
    }

    write_packet(&mut stream, 2, 2, &command).map_err(|e| e.to_string())?;
    loop {
        let (id, _, body) = read_packet(&mut stream).map_err(|e| e.to_string())?;
        if id == 2 {
            return Ok(body);
        }
    }
}

fn write_packet(stream: &mut TcpStream, id: i32, kind: i32, body: &str) -> std::io::Result<()> {
    let bytes = body.as_bytes();
    let length = (4 + 4 + bytes.len() + 2) as i32;
    let mut out = Vec::with_capacity(4 + length as usize);
    out.extend_from_slice(&length.to_le_bytes());
    out.extend_from_slice(&id.to_le_bytes());
    out.extend_from_slice(&kind.to_le_bytes());
    out.extend_from_slice(bytes);
    out.extend_from_slice(&[0, 0]);
    stream.write_all(&out)
}

fn read_packet(stream: &mut TcpStream) -> std::io::Result<(i32, i32, String)> {
    let mut header = [0u8; 4];
    stream.read_exact(&mut header)?;
    let length = i32::from_le_bytes(header) as usize;

    let mut payload = vec![0u8; length];
    stream.read_exact(&mut payload)?;

    let id = i32::from_le_bytes(payload[0..4].try_into().unwrap());
    let kind = i32::from_le_bytes(payload[4..8].try_into().unwrap());
    let body = String::from_utf8_lossy(&payload[8..length.saturating_sub(2)]).into_owned();
    Ok((id, kind, body))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![rcon_exec])
        .run(tauri::generate_context!())
        .expect("error while running Slotify");
}
