import os
import sys
import subprocess
import threading
from typing import Tuple, Optional

import win32print
from PIL import Image, ImageDraw, ImageFont
import barcode
from barcode.writer import ImageWriter

try:
    from .config import DEFAULT_PRINTER_NAME
except ImportError:
    DEFAULT_PRINTER_NAME = "AiYin_D11"

PRINTER_NAME = "AiYin_D11"
LABEL_WIDTH_PX = 96   # 12mm - 15mm printable width (96 dots on D11 printhead)
LABEL_LENGTH_PX = 320 # 40mm length at 203 DPI (8 dots/mm = 320 dots)

def get_best_font(size: int, bold: bool = False):
    """Tìm font hệ thống Windows đẹp và sắc nét nhất cho máy in nhiệt."""
    font_candidates = [
        "C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf",
        "C:/Windows/Fonts/segoeuib.ttf" if bold else "C:/Windows/Fonts/segoeui.ttf",
        "C:/Windows/Fonts/tahoma.ttf",
        "C:/Windows/Fonts/consola.ttf"
    ]
    for p in font_candidates:
        if os.path.isfile(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                pass
    return ImageFont.load_default()

def render_label_15x40(anydesk_id: str, iot_id: str) -> Image.Image:
    """
    Vẽ con tem 15x40mm chuẩn theo mẫu người dùng cung cấp:
    - Nửa bên trái: Mã vạch Code 128 (AnyDesk ID) + Chữ AnyDesk ID ở dưới
    - Nửa bên phải: Mã IoT ID cỡ chữ to, đậm, căn giữa theo chiều dọc
    """
    canvas_w, canvas_h = LABEL_LENGTH_PX, LABEL_WIDTH_PX # 320 x 96
    canvas = Image.new("L", (canvas_w, canvas_h), color=255)
    draw = ImageDraw.Draw(canvas)

    anydesk_clean = str(anydesk_id or "").replace(" ", "").strip()
    iot_clean = str(iot_id or "").strip()
    if not anydesk_clean:
        anydesk_clean = "000000000"
    if not iot_clean:
        iot_clean = "---"

    # 1. TẠO MÃ VẠCH CODE 128 (ANYDESK ID)
    code128 = barcode.get_barcode_class("code128")
    writer = ImageWriter()
    writer.dpi = 203
    writer_options = {
        "write_text": False,
        "module_width": 0.25, # Đúng chuẩn 2 dots / module tại 203 DPI -> cực kỳ sắc nét
        "module_height": 6.2, # Chiều cao vạch ~50 dots
        "quiet_zone": 0.8,
    }
    bc = code128(anydesk_clean, writer=writer)
    bc_img = bc.render(writer_options).convert("L")

    # Cắt bỏ khoảng trắng đệm dọc thừa từ thư viện barcode
    bbox = Image.eval(bc_img, lambda x: 255 - x).getbbox()
    if bbox:
        bc_cropped = bc_img.crop((0, bbox[1], bc_img.width, bbox[3]))
    else:
        bc_cropped = bc_img

    # Dán mã vạch vào bên trái canvas
    bc_x = 4
    bc_y = 6
    canvas.paste(bc_cropped, (bc_x, bc_y))

    # 2. VẼ CHỮ ANYDESK ID NGAY DƯỚI MÃ VẠCH (CĂN GIỮA MÃ VẠCH)
    font_ad = get_best_font(size=16, bold=False)
    ad_bbox = draw.textbbox((0, 0), anydesk_clean, font=font_ad)
    ad_w = ad_bbox[2] - ad_bbox[0]
    ad_x = bc_x + (bc_cropped.width - ad_w) // 2
    ad_y = bc_y + bc_cropped.height + 3
    draw.text((ad_x, ad_y), anydesk_clean, fill=0, font=font_ad)

    # 3. VẼ MÃ IOT BÊN PHẢI (CHỮ TO, IN ĐẬM, CĂN GIỮA KHỐI PHẢI)
    font_size = 28 if len(iot_clean) <= 6 else (22 if len(iot_clean) <= 9 else 16)
    font_iot = get_best_font(size=font_size, bold=True)
    iot_bbox = draw.textbbox((0, 0), iot_clean, font=font_iot)
    iot_w = iot_bbox[2] - iot_bbox[0]
    iot_h = iot_bbox[3] - iot_bbox[1]

    right_zone_start = bc_x + bc_cropped.width + 4
    right_zone_width = canvas_w - right_zone_start
    iot_x = right_zone_start + max(0, (right_zone_width - iot_w) // 2)
    iot_y = (canvas_h - iot_h) // 2 - 4
    draw.text((iot_x, iot_y), iot_clean, fill=0, font=font_iot)

    # Xoay -90 độ để khớp hướng đẩy giấy của đầu in nhiệt (đầu in 96px x chiều dài 320px)
    return canvas.rotate(-90, expand=True)

def build_d11_raster_payload(img: Image.Image, density: int = 3) -> bytes:
    """
    Đóng gói dữ liệu ảnh nhãn thành chuỗi byte nhị phân chuẩn giao thức AiYin D11S / Fichero:
    - Density: Mức nhiệt in (1-5, mặc định 3)
    - Paper: Gap label (khoảng cách nhãn bóc dán)
    - Enable: 10 FF FE 01
    - Raster ESC/POS: 1D 76 30 00 0C 00 yL yH + bitmap (MSB first)
    - Form feed: 1D 0C
    - Stop: 10 FF FE 45
    """
    w, h = img.size
    assert w == LABEL_WIDTH_PX, f"Độ rộng nhãn phải là {LABEL_WIDTH_PX}px, hiện tại là {w}px"

    payload = bytearray()
    # Khởi tạo thông số máy in
    payload.extend(b"\x10\xff\x10\x00" + bytes([density])) # Mức nhiệt
    payload.extend(b"\x10\xff\x84\x00")                    # Loại giấy cuộn bóc dán (Gap)
    payload.extend(b"\x00\x00")                            # Wake-up
    payload.extend(b"\x10\xff\xfe\x01")                    # AiYin Enable

    # Header raster bitmap ESC/POS GS v 0
    xL = 12 # 96 pixels / 8 = 12 bytes mỗi hàng
    xH = 0
    yL = h % 256
    yH = h // 256
    payload.extend(b"\x1d\x76\x30\x00" + bytes([xL, xH, yL, yH]))

    # Dữ liệu điểm ảnh nhị phân: 1 = đen (đốt nhiệt), 0 = trắng
    for y in range(h):
        row_bytes = bytearray(12)
        for x in range(96):
            px = img.getpixel((x, y))
            if px < 128:
                row_bytes[x // 8] |= (1 << (7 - (x % 8)))
        payload.extend(row_bytes)

    # Đẩy giấy đến rãnh xé tiếp theo và kết thúc lệnh
    payload.extend(b"\x1d\x0c")         # Form feed
    payload.extend(b"\x10\xff\xfe\x45") # AiYin Stop
    return bytes(payload)

def ensure_printer_installed(printer_name: str = PRINTER_NAME) -> bool:
    """Kiểm tra và tự động kích hoạt máy in trong Windows nếu chưa có."""
    try:
        printers = [p[2] for p in win32print.EnumPrinters(2)]
        if printer_name in printers:
            return True
        
        # Nếu chưa có -> Tự động thêm máy in vào USB001
        cmd = f'Add-Printer -Name "{printer_name}" -DriverName "Generic / Text Only" -PortName "USB001"'
        res = subprocess.run(["powershell", "-NoProfile", "-Command", cmd], capture_output=True, text=True)
        return res.returncode == 0
    except Exception:
        return False

def print_box_label(anydesk_id: str, iot_id: str, printer_name: str = PRINTER_NAME) -> Tuple[bool, str]:
    """
    Hàm 1-Click in tem dán Box:
    - anydesk_id: Mã AnyDesk (VD: 1233589246)
    - iot_id: Mã IoT (VD: 11250)
    - Trả về: (True, "Thành công") hoặc (False, "Lỗi...")
    """
    try:
        if not ensure_printer_installed(printer_name):
            return False, f"Không tìm thấy máy in '{printer_name}' trên Windows và không thể tự động kết nối USB001."

        # Tạo phôi tem
        img = render_label_15x40(anydesk_id=anydesk_id, iot_id=iot_id)
        raw_payload = build_d11_raster_payload(img)

        # Gửi dữ liệu RAW xuống Windows Print Spooler
        hPrinter = win32print.OpenPrinter(printer_name)
        try:
            job_name = f"BoxLabel_{anydesk_id}_{iot_id}"
            win32print.StartDocPrinter(hPrinter, 1, (job_name, None, "RAW"))
            win32print.StartPagePrinter(hPrinter)
            win32print.WritePrinter(hPrinter, raw_payload)
            win32print.EndPagePrinter(hPrinter)
            win32print.EndDocPrinter(hPrinter)
        finally:
            win32print.ClosePrinter(hPrinter)

        return True, f"Đã in tem thành công cho Box (AnyDesk: {anydesk_id} | IoT: {iot_id})"
    except Exception as e:
        return False, f"Lỗi khi gửi lệnh in: {str(e)}"

def print_box_label_async(anydesk_id: str, iot_id: str, callback=None, printer_name: str = PRINTER_NAME):
    """Bắn lệnh in trong luồng ngầm (tránh đứng giao diện UI)."""
    def _worker():
        ok, msg = print_box_label(anydesk_id=anydesk_id, iot_id=iot_id, printer_name=printer_name)
        if callback:
            callback(ok, msg)
    t = threading.Thread(target=_worker, daemon=True)
    t.start()
    return t
