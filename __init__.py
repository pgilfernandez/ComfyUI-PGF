import asyncio
import base64
import ipaddress
import os
import subprocess
import sys
import tempfile
from pathlib import Path

from aiohttp import web
from server import PromptServer

WEB_DIRECTORY = "./web"
NODE_CATEGORY = "🐬 PGF"
picker_lock = asyncio.Lock()
MAX_SELECTOR_INPUTS = 100


def list_text_files(folder):
    if not folder.strip():
        return []

    directory = Path(folder.strip().strip('"')).expanduser()
    if not directory.is_absolute():
        raise ValueError("Enter an absolute folder path.")

    return sorted(
        (path for path in directory.iterdir()
         if path.suffix.lower() == ".txt" and path.is_file()),
        key=lambda path: (path.name.casefold(), path.name),
    )


@PromptServer.instance.routes.get("/pgf/text-files")
async def get_text_files(request):
    try:
        files = await asyncio.to_thread(list_text_files, request.query.get("folder", ""))
    except (OSError, ValueError, RuntimeError) as error:
        return web.json_response({"error": str(error)}, status=400)
    return web.json_response({"files": [path.name for path in files]})


def is_local_request(request):
    try:
        remote = ipaddress.ip_address(request.remote)
        remote = getattr(remote, "ipv4_mapped", None) or remote
    except ValueError:
        return False
    return remote.is_loopback


@PromptServer.instance.routes.post("/pgf/pick-{kind:folder|file}")
async def pick_path(request):
    kind = request.match_info["kind"]
    if not is_local_request(request):
        return web.json_response({"error": "The system picker requires a local connection."}, status=403)

    if request.content_type != "application/json":
        return web.json_response({"error": "Expected a JSON request."}, status=415)
    try:
        body = await request.json()
        initial_path = body[kind]
        if not isinstance(initial_path, str) or "\0" in initial_path:
            raise ValueError
    except (KeyError, TypeError, ValueError):
        return web.json_response({"error": "Invalid path."}, status=400)

    if picker_lock.locked():
        return web.json_response({"error": "A system picker is already open."}, status=409)

    async with picker_lock:
        try:
            if sys.platform != "win32":
                return web.json_response({"error": "The system picker requires Windows."}, status=501)

            script = Path(__file__).with_name("_folder_picker.ps1")
            encoded_script = base64.b64encode(script.read_text(encoding="utf-8").encode("utf-16-le")).decode("ascii")
            env = {
                **os.environ,
                "PGF_PICKER_KIND": kind,
                "PGF_FOLDER_PICKER_START": initial_path.strip().strip('"'),
            }
            result = await asyncio.to_thread(
                subprocess.run,
                ["powershell.exe", "-NoProfile", "-STA", "-EncodedCommand", encoded_script],
                capture_output=True,
                encoding="utf-8",
                check=True,
                creationflags=subprocess.CREATE_NO_WINDOW,
                env=env,
                timeout=300,
            )
            path = result.stdout or None
        except (OSError, ValueError, subprocess.SubprocessError):
            return web.json_response({"error": "Could not open the system picker."}, status=503)

    return web.json_response({kind: path})


@PromptServer.instance.routes.post("/pgf/save-edited-text")
async def save_edited_text(request):
    if not is_local_request(request):
        return web.json_response({"error": "Saving requires a local connection."}, status=403)
    if request.content_type != "application/json":
        return web.json_response({"error": "Expected a JSON request."}, status=415)

    try:
        body = await request.json()
        path, filename, text = (body[key] for key in ("path", "filename", "text"))
        if not all(isinstance(value, str) for value in (path, filename, text)):
            raise ValueError("Expected a folder, filename and text.")
        directory = Path(path.strip().strip('"')).expanduser()
        if not directory.is_absolute():
            raise ValueError("Enter the absolute path of a folder.")
        filename = filename.strip()
        if filename.lower().endswith(".txt"):
            filename = filename[:-4]
        if not filename or filename.endswith((".", " ")) or any(
            char in '<>:"/\\|?*' or ord(char) < 32 for char in filename
        ):
            raise ValueError("Enter a valid filename without a directory.")
        destination = directory / f"{filename}.txt"
        await asyncio.to_thread(save_text_file, destination, text)
    except (KeyError, TypeError, ValueError, OSError, RuntimeError) as error:
        return web.json_response({"error": str(error)}, status=400)
    return web.json_response({"file": str(destination)})


def save_text_file(path, text):
    temporary_path = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", newline="", dir=path.parent, delete=False
        ) as temporary:
            temporary_path = Path(temporary.name)
            temporary.write(text)
        temporary_path.replace(path)
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)


class PGFLoadTextFile:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "folder": ("STRING", {"default": "", "tooltip": "Absolute folder path"}),
                "index": ("INT", {"default": 0, "max": 2147483647}),
            }
        }

    RETURN_TYPES = ("STRING", "STRING", "INT", "INT")
    RETURN_NAMES = ("text", "file_name", "index", "total")
    FUNCTION = "load"
    CATEGORY = f"{NODE_CATEGORY}/Text"

    @classmethod
    def IS_CHANGED(cls, folder, index):
        index = max(0, index)
        try:
            files = list_text_files(folder)
            if 0 <= index < len(files):
                path = files[index]
                stat = path.stat()
                return (str(path), stat.st_mtime_ns, stat.st_size, len(files))
        except (OSError, ValueError, RuntimeError):
            pass
        return float("nan")

    def load(self, folder, index):
        index = max(0, index)
        files = list_text_files(folder)
        total = len(files)
        if total == 0:
            return ("", "", index, 0)
        if not 0 <= index < total:
            raise ValueError(f"Index {index} is out of range for {total} text files.")

        path = files[index]
        return (path.read_text(encoding="utf-8-sig"), path.stem, index, total)


class PGFLoadSingleTextFile:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"file": ("STRING", {"default": "", "tooltip": "Absolute .txt file path"})}}

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("text",)
    FUNCTION = "load"
    CATEGORY = f"{NODE_CATEGORY}/Text"

    @staticmethod
    def text_path(file):
        path = Path(file.strip().strip('"')).expanduser()
        if not path.is_absolute() or path.suffix.lower() != ".txt":
            raise ValueError("Choose a .txt file or enter its absolute path.")
        return path

    @classmethod
    def IS_CHANGED(cls, file):
        try:
            stat = cls.text_path(file).stat()
            return (stat.st_mtime_ns, stat.st_size)
        except (OSError, ValueError, RuntimeError):
            return float("nan")

    def load(self, file):
        return (self.text_path(file).read_text(encoding="utf-8-sig"),)


class PGFEditTextFile:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "editor": ("STRING", {"default": "", "multiline": True}),
                "path": ("STRING", {"default": "", "tooltip": "Absolute folder path"}),
                "filename": ("STRING", {"default": "", "tooltip": "Filename without .txt"}),
                "use_editor": ("BOOLEAN", {"default": False}),
            },
            "optional": {"text": ("STRING", {"forceInput": True})},
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("text",)
    FUNCTION = "edited_text"
    OUTPUT_NODE = True
    CATEGORY = f"{NODE_CATEGORY}/Text"

    def edited_text(self, editor, path, filename, use_editor, text=None):
        result = editor if use_editor or text is None else text
        return {"ui": {"path": [path], "filename": [filename], "text": [result]}, "result": (result,)}


class IndexedSelector:
    FUNCTION = "select"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "index": ("INT", {"default": 0, "min": 0, "max": MAX_SELECTOR_INPUTS - 1}),
            },
            "optional": {
                f"{cls.RETURN_NAMES[0]}_{index}": (cls.RETURN_TYPES[0], {"lazy": True, "forceInput": True})
                for index in range(MAX_SELECTOR_INPUTS)
            },
        }

    def check_lazy_status(self, index, **values):
        name = f"{self.RETURN_NAMES[0]}_{index}"
        return [name] if name in values and values[name] is None else []

    def select(self, index, **values):
        name = self.RETURN_NAMES[0]
        value = values.get(f"{name}_{index}")
        if value is None:
            raise ValueError(f"Connect a value to {name}_{index} or select a connected index.")
        return (value,)


class PGFImageSelector(IndexedSelector):
    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("image",)
    CATEGORY = f"{NODE_CATEGORY}/Image"


class PGFBooleanSelector(IndexedSelector):
    RETURN_TYPES = ("BOOLEAN",)
    RETURN_NAMES = ("boolean",)
    CATEGORY = f"{NODE_CATEGORY}/Logic"


class PGFDurationSelector(IndexedSelector):
    RETURN_TYPES = ("FLOAT", "INT")
    RETURN_NAMES = ("duration", "duration_int")
    CATEGORY = f"{NODE_CATEGORY}/Video"

    def select(self, index, **values):
        (duration,) = super().select(index, **values)
        return (duration, int(duration))


NODE_CLASS_MAPPINGS = {
    "PGFLoadTextFile": PGFLoadTextFile,
    "PGFLoadSingleTextFile": PGFLoadSingleTextFile,
    "PGFEditTextFile": PGFEditTextFile,
    "PGFImageSelector": PGFImageSelector,
    "PGFBooleanSelector": PGFBooleanSelector,
    "PGFDurationSelector": PGFDurationSelector,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "PGFLoadTextFile": "PGF - Load Text Files",
    "PGFLoadSingleTextFile": "PGF - Load Text File",
    "PGFEditTextFile": "PGF - Edit Text File",
    "PGFImageSelector": "PGF - Image selector",
    "PGFBooleanSelector": "PGF - Boolean selector",
    "PGFDurationSelector": "PGF - Duration selector",
}
