/**
 * EduAI Pro – server nội bộ (không cần cài thêm thư viện, yêu cầu Node.js 18+)
 *
 *  - Phục vụ giao diện index.html
 *  - Giữ GEMINI_API_KEY trong file .env (phía server) và chuyển tiếp yêu cầu tới Gemini,
 *    nên key KHÔNG bao giờ xuất hiện trong trình duyệt.
 *
 * Chạy:  node server.js   →  mở http://localhost:3000
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

/* ---------- Đọc file .env (đơn giản, không cần dotenv) ---------- */
function loadEnv(file) {
  try {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!m || line.trim().startsWith('#')) continue;
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (process.env[m[1]] === undefined) process.env[m[1]] = v;
    }
  } catch { /* không có .env cũng không sao, sẽ báo lỗi khi gọi API */ }
}
loadEnv(path.join(__dirname, '.env'));

const PORT = Number(process.env.PORT) || 3000;
// Mặc định chỉ cho máy này truy cập. Muốn cả mạng LAN dùng: HOST=0.0.0.0 trong .env
const HOST = process.env.HOST || '127.0.0.1';
const API_KEY = (process.env.GEMINI_API_KEY || '').trim();
const ALLOWED_MODELS = new Set(['gemini-2.5-flash', 'gemini-2.5-pro']);
const MAX_BODY = 25 * 1024 * 1024; // ảnh Base64 có thể khá nặng

const sendJSON = (res, status, obj) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
};
// Tiền tố [EduAI] để giao diện hiển thị nguyên văn thông báo này
const fail = (res, status, msg) => sendJSON(res, status, { error: { message: '[EduAI] ' + msg } });

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(new Error('TOO_LARGE')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  // Giao diện
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    return fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
      if (err) return fail(res, 500, 'Không tìm thấy index.html cạnh server.js.');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  }

  // Kiểm tra nhanh cấu hình (không trả key)
  if (req.method === 'GET' && url.pathname === '/api/health') return sendJSON(res, 200, { ok: true, hasKey: !!API_KEY });

  // Proxy tới Gemini
  if (req.method === 'POST' && url.pathname === '/api/generate') {
    if (!API_KEY) return fail(res, 500, 'Máy chủ chưa có GEMINI_API_KEY. Hãy tạo file .env (xem .env.example) rồi khởi động lại server.');
    const model = url.searchParams.get('model') || 'gemini-2.5-flash';
    if (!ALLOWED_MODELS.has(model)) return fail(res, 400, 'Mô hình không được phép: ' + model);
    let body;
    try { body = await readBody(req); } catch (e) { return fail(res, 413, 'Dữ liệu gửi lên quá lớn (ảnh nặng quá).'); }
    try {
      const upstream = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': API_KEY },
        body
      });
      const text = await upstream.text();
      res.writeHead(upstream.status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(text);
    } catch (e) {
      return fail(res, 502, 'Server không kết nối được tới Gemini. Kiểm tra Internet/proxy của máy chủ.');
    }
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
});

server.listen(PORT, HOST, () => {
  console.log(`EduAI Pro đang chạy tại http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  if (!API_KEY) console.warn('⚠  Chưa có GEMINI_API_KEY trong .env – tạo file .env từ .env.example rồi chạy lại.');
});
