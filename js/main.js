/* Entry point for the board (index.html). The view registry: the picker
   lists views in this order. Adding an app = one module in views/, one pane
   in index.html, one stylesheet in css/views/, and one line here.
   See docs/ARCHITECTURE.md. */
import { register, start } from "./core/shell.js";
import courses from "./views/courses.js";
import { timetable, rota } from "./views/schedule.js";
import tickets from "./views/tickets.js";
import invoices from "./views/invoices.js";
import forms from "./views/forms.js";
import staff from "./views/staff.js";
import apps from "./views/apps.js";
import admin from "./views/admin.js";
import sheet from "./views/sheet.js";

register(courses);
register(timetable);
register(rota);
register(tickets);
register(invoices);
register(forms);
register(staff);
register(apps);
register(admin);
register(sheet);        // no pane or menu entry - registered so sign-out closes it

start();
