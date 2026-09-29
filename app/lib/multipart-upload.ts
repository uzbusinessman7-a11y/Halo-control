export type MultipartJsonResult<T> = {
  ok: boolean;
  status: number;
  data: T;
};

const uploadExtension = (file: File) => {
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  return "jpg";
};

export function appendImageToForm(form: FormData, field: string, file: File, label: string) {
  form.append(field, file, `${label}.${uploadExtension(file)}`);
}

/**
 * XMLHttpRequest is intentionally used for multipart image uploads. Installed
 * iPhone web apps can reject an otherwise valid fetch(FormData) request with a
 * WebKit DOMException before the request reaches the server.
 */
export function postMultipartJson<T>(url: string, form: FormData): Promise<MultipartJsonResult<T>> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", url, true);
    request.withCredentials = true;
    request.timeout = 90_000;
    request.onload = () => {
      if (request.status === 413) {
        reject(new Error("Rasm hajmi server chegarasidan oshdi. Sahifani yangilang va rasmni qayta tanlang."));
        return;
      }
      let data: T;
      try {
        data = JSON.parse(request.responseText || "{}") as T;
      } catch {
        reject(new Error("Server javobi o‘qilmadi. Qayta urinib ko‘ring."));
        return;
      }
      resolve({ ok: request.status >= 200 && request.status < 300, status: request.status, data });
    };
    request.onerror = () => reject(new Error("Rasm yuborilmadi. Internetni tekshirib qayta urinib ko‘ring."));
    request.ontimeout = () => reject(new Error("Rasm yuborish vaqti tugadi. Internetni tekshirib qayta urinib ko‘ring."));
    request.onabort = () => reject(new Error("Rasm yuborish bekor qilindi."));
    request.send(form);
  });
}
