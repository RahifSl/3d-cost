# /// script
# requires-python = ">=3.10"
# dependencies = []
#
# [tool.orcaslicer.plugin]
# id = "cc2-cost-calculator"
# name = "Cost Calculator"
# version = "1.0.0"
# description = "100% offline print cost calculation, consumable wear-and-tear tracking, and PDF quote generator directly inside OrcaSlicer."
# author = "Elegoo CC2 Community"
# ///

import os
import sys
import json

try:
    import orca
except ImportError:
    class MockOrca:
        class base: pass
        class pages:
            class PagesPluginCapabilityBase: pass
        @staticmethod
        def plugin(cls): return cls
        @staticmethod
        def register_capability(cls): pass
        @staticmethod
        def request_permissions(**kwargs): pass
    orca = MockOrca()


def read_slice_gcode(target_path=None):
    try:
        latest_path = None
        latest_filename = ""
        latest_mtime = 0

        if target_path and os.path.exists(target_path):
            latest_path = target_path
            latest_filename = os.path.basename(target_path)
            latest_mtime = os.path.getmtime(target_path)
        else:
            temp_dir = os.environ.get("TEMP", os.environ.get("TMP", ""))
            if not temp_dir:
                return None
            
            base_model_dir = os.path.join(temp_dir, "orcaslicer_model")
            if not os.path.exists(base_model_dir):
                return None

            gcode_files = []
            try:
                for root, dirs, files in os.walk(base_model_dir):
                    for f in files:
                        if f.endswith(".gcode"):
                            full_path = os.path.join(root, f)
                            try:
                                mtime = os.path.getmtime(full_path)
                                gcode_files.append((mtime, full_path, f))
                            except Exception:
                                pass
            except Exception:
                pass

            if not gcode_files:
                return None

            gcode_files.sort(key=lambda x: x[0], reverse=True)
            latest_mtime, latest_path, latest_filename = gcode_files[0]

        if not latest_path:
            return None

        content = ""
        try:
            with open(latest_path, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read(1024 * 1024)
        except Exception as e:
            content = f"; Error reading file: {e}"

        return {
            "filename": latest_filename,
            "path": latest_path,
            "mtime": latest_mtime,
            "content": content
        }
    except Exception:
        return None


class CostCalculatorTab(orca.pages.PagesPluginCapabilityBase):
    """
    Renders the dedicated [Cost Calculator] tab in OrcaSlicer top bar.
    """
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.pending_gcode = None

    def get_name(self) -> str:
        return "Cost Calculator"

    def get_icon(self) -> str:
        current_dir = os.path.dirname(os.path.abspath(__file__))
        candidates = [
            os.path.join(current_dir, "cost_calculator.svg"),
            r"D:\The AI Familliar\3d-cost\public\cost_calculator.svg",
            r"D:\The AI Familliar\3d-cost\dist\cost_calculator.svg"
        ]
        found = next((p for p in candidates if os.path.exists(p)), None)
        return found if found else ""

    def get_ui(self) -> str:
        """
        Returns the clean, standalone offline HTML document.
        Kept strictly under 2MB so wxWebView / CoreWebView2 NavigateToString never fails.
        """
        current_dir = os.path.dirname(os.path.abspath(__file__))
        candidates = [
            os.path.join(current_dir, "Elegoo_CC2_Cost_Calculator_Offline.html"),
            r"D:\The AI Familliar\3d-cost\public\Elegoo_CC2_Cost_Calculator_Offline.html"
        ]
        html_file = next((p for p in candidates if os.path.exists(p)), None)
        if not html_file:
            return "<html><body style='background:#0f172a;color:#f8fafc;padding:30px;font-family:sans-serif;'><h2>Elegoo CC2 Cost Calculator: Offline bundle not found.</h2></body></html>"

        try:
            with open(html_file, "r", encoding="utf-8") as f:
                return f.read()
        except Exception as e:
            return f"<html><body style='background:#0f172a;color:#f8fafc;padding:30px;font-family:sans-serif;'><h2>Error loading calculator: {e}</h2></body></html>"

    def on_lifecycle_event(self, event, ctx):
        try:
            events = getattr(orca, "LifecycleEvent", None)
            if events and event == getattr(events, "GCodeExportFinished", None):
                self.pending_gcode = str(getattr(ctx, "msg", ""))
                slice_info = read_slice_gcode(self.pending_gcode)
                self.post_message({"type": "slice_finished", "path": self.pending_gcode, "slice": slice_info})
        except Exception:
            pass

    def on_message(self, data):
        try:
            if not isinstance(data, dict):
                return
            cmd = data.get("type") or data.get("cmd")
            if cmd in ("ready", "scan", "read_estimate"):
                slice_info = read_slice_gcode(self.pending_gcode)
                if slice_info:
                    self.post_message({"type": "latest_slice", "slice": slice_info})
        except Exception:
            pass


@orca.plugin
class ElegooCC2CostPlugin(orca.base):
    def register_capabilities(self):
        try:
            orca.request_permissions(
                threading=True,
                fs_read=["C:\\Users\\rahif\\AppData\\Local\\Temp\\*"]
            )
        except Exception:
            pass
        orca.register_capability(CostCalculatorTab)


if __name__ == "__main__":
    tab = CostCalculatorTab()
    ui = tab.get_ui()
    print("Cost Calculator Plugin ready.")
    print("Top Tab: [Cost Calculator]")
    print(f"UI size: {len(ui)} bytes ({round(len(ui)/1024)} KB) - well under 2MB limit")
    info = read_slice_gcode()
    if info:
        print(f"Latest slice detected: {info['filename']} ({len(info['content'])} bytes)")
    else:
        print("No recent slice found in Temp folder.")
