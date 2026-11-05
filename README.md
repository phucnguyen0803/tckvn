# VN Stock Pro – bản web (Netlify)

Theo dõi realtime & phân tích cổ phiếu Việt Nam ngay trên trình duyệt: thị trường, danh mục yêu thích, máy quét cơ hội, phân tích chuyên sâu một mã (kỹ thuật, BCTC, định giá, vùng mua/SL/TP, khối lượng).

## Cấu trúc
```
netlify.toml                  cấu hình Netlify
netlify/functions/api.mjs     hàm serverless lấy dữ liệu VNDirect/Vietcap (/api/...)
public/index.html             giao diện
public/js/app.js              các trang & biểu đồ
public/js/api.js              gọi API + cache
public/js/core/*.js           mô hình phân tích (chỉ báo, kỹ thuật, cơ bản, kế hoạch giao dịch)
public/PHUONG_PHAP.md         mô tả phương pháp (hiển thị ở trang Phương pháp)
```

## Deploy lên Netlify – Cách 1: qua GitHub (khuyên dùng, không cần cài gì)
1. Tạo tài khoản https://github.com và https://app.netlify.com (đăng nhập Netlify bằng GitHub).
2. Trên GitHub: **New repository** → đặt tên `vnstock-web` → **Create**.
   Bấm **uploading an existing file** → kéo **toàn bộ nội dung** thư mục `vnstock_web` (gồm `netlify.toml`, `netlify/`, `public/`) vào → **Commit changes**.
3. Trên Netlify: **Add new site → Import an existing project → GitHub** → chọn `vnstock-web`.
   Các ô cấu hình để nguyên (Netlify đọc từ `netlify.toml`) → **Deploy**.
4. Sau ~1 phút bạn có địa chỉ dạng `https://ten-ngau-nhien.netlify.app`.
   Đổi tên: **Site configuration → Change site name** → ví dụ `vnstockpro` → `https://vnstockpro.netlify.app`.

Mỗi lần sửa code trên GitHub, Netlify tự deploy lại.

> ⚠️ Không dùng kiểu "kéo thả thư mục" (Netlify Drop): cách đó không chạy được hàm `/api`, trang sẽ không có dữ liệu.

## Cách 2: Netlify CLI (cần Node.js)
```bash
cd vnstock_web
npx netlify-cli login
npx netlify-cli deploy --prod      # chọn "Create & configure a new site"
```
Chạy thử trên máy: `npx netlify-cli dev` → mở http://localhost:8888

## Ghi chú
- Danh mục & cài đặt vốn lưu trong trình duyệt (localStorage). Chuyển sang máy khác: trang **⚙️ Quản trị vốn → Sao lưu danh mục**.
- Gói miễn phí Netlify (125.000 lượt gọi hàm/tháng) đủ cho dùng cá nhân. Quét toàn HOSE tốn ~30 lượt gọi.
- Trang công khai: ai có link đều dùng được. Muốn giới hạn người xem, bật **Password protection** (gói trả phí) hoặc đặt tên site khó đoán.
- Dữ liệu từ API công khai của VNDirect/Vietcap, có thể thay đổi; nếu lỗi, sửa trong `netlify/functions/api.mjs`.
- ⚠️ Công cụ hỗ trợ phân tích, **không phải lời khuyên đầu tư**.
