// PocketBase JS Hook - Tương thích ngược với định dạng Google Apps Script Webhook
// Cung cấp endpoint: POST /api/sgl_webhook

routerAdd("POST", "/api/sgl_webhook", (c) => {
    let data = {};
    try {
        data = c.requestInfo().body || {};
    } catch (e) {
        data = {};
    }

    const action = data.action || "";
    const now = new Date().toISOString();

    // 1. Đăng ký thiết bị (Register Device)
    if (action === "register_device") {
        let mac = (data.mac || "").replace(/[^a-fA-F0-9]/g, "").toUpperCase();
        let anydesk = (data.anydesk_id || "").replace(/\s+/g, "").trim();
        let project = (data.project || "").trim();

        if (!mac) {
            return c.json(400, { status: "error", message: "Thiếu MAC" });
        }

        try {
            let record = $app.findFirstRecordByFilter("devices", "mac = {:mac}", { mac: mac });
            if (anydesk) record.set("anydesk_id", anydesk);
            if (project) record.set("project", project);
            record.set("status", "new");
            $app.save(record);
        } catch (err) {
            let collection = $app.findCollectionByNameOrId("devices");
            let record = new Record(collection);
            record.set("mac", mac);
            record.set("anydesk_id", anydesk);
            record.set("project", project);
            record.set("status", "new");
            record.set("last_seen", now);
            $app.save(record);
        }

        return c.json(200, { status: "ok", message: "Đăng ký thành công" });
    }

    // 2. Nhịp tim (Heartbeat)
    if (action === "heartbeat") {
        let mac = (data.mac || "").replace(/[^a-fA-F0-9]/g, "").toUpperCase();
        if (!mac) {
            return c.json(400, { status: "error", message: "Thiếu MAC" });
        }

        try {
            let record = $app.findFirstRecordByFilter("devices", "mac = {:mac}", { mac: mac });
            record.set("last_seen", now);
            record.set("status", "online");
            if (data.app_version) record.set("app_version", String(data.app_version));
            if (data.storage_mb) record.set("storage_mb", String(data.storage_mb));
            $app.save(record);
        } catch (err) {
            try {
                let collection = $app.findCollectionByNameOrId("devices");
                let record = new Record(collection);
                record.set("mac", mac);
                record.set("status", "online");
                record.set("last_seen", now);
                if (data.app_version) record.set("app_version", String(data.app_version));
                if (data.storage_mb) record.set("storage_mb", String(data.storage_mb));
                $app.save(record);
            } catch (e2) {}
        }

        try {
            let hbColl = $app.findCollectionByNameOrId("heartbeats");
            let hbRecord = new Record(hbColl);
            hbRecord.set("mac", mac);
            hbRecord.set("timestamp", now);
            if (data.ram_mb) hbRecord.set("ram_mb", Number(data.ram_mb));
            if (data.storage_mb) hbRecord.set("storage_mb", Number(data.storage_mb));
            if (data.current_task) hbRecord.set("current_task", String(data.current_task));
            if (data.app_version) hbRecord.set("app_version", String(data.app_version));
            if (data.ip) hbRecord.set("ip", String(data.ip));
            $app.save(hbRecord);
        } catch (e3) {}

        return c.json(200, { status: "ok", message: "Heartbeat đã ghi nhận" });
    }

    // 3. Nhận lệnh nhiệm vụ (Claim Task)
    if (action === "claim_task") {
        let mac = (data.mac || "").replace(/[^a-fA-F0-9]/g, "").toUpperCase();
        if (!mac) {
            return c.json(400, { status: "error", message: "Thiếu MAC" });
        }

        try {
            let task = $app.findFirstRecordByFilter("tasks", "target_mac = {:mac} && status = 'pending'", { mac: mac });
            task.set("status", "claimed");
            task.set("claimed_at", now);
            $app.save(task);

            let stepsJson = "[]";
            try {
                let tmpl = $app.findFirstRecordByFilter("templates", "template_name = {:name}", { name: task.getString("template_name") });
                stepsJson = tmpl.getString("steps_json");
            } catch (te) {}

            return c.json(200, {
                status: "ok",
                has_task: true,
                task_id: task.getString("task_id"),
                template_name: task.getString("template_name"),
                steps_json: stepsJson
            });
        } catch (err) {
            return c.json(200, { status: "ok", has_task: false, message: "Không có task" });
        }
    }

    // 4. Báo cáo hoàn thành nhiệm vụ (Complete Task)
    if (action === "complete_task") {
        let taskId = (data.task_id || "").trim();
        let status = (data.status || "completed").toLowerCase();
        let result = data.result || "";

        if (!taskId) {
            return c.json(400, { status: "error", message: "Thiếu task_id" });
        }

        try {
            let task = $app.findFirstRecordByFilter("tasks", "task_id = {:tid}", { tid: taskId });
            task.set("status", status);
            task.set("completed_at", now);
            task.set("result", String(result));
            $app.save(task);
            return c.json(200, { status: "ok", message: "Task đã cập nhật" });
        } catch (err) {
            return c.json(404, { status: "error", message: "Không tìm thấy task_id: " + taskId });
        }
    }

    return c.json(400, { status: "error", message: "Hành động không hợp lệ: " + action });
});
