/* SWCore -- generado desde functions/shared/*.js por esbuild (npm run build:core). No editar a mano. */
"use strict";
var SWCore = (() => {
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __commonJS = (cb, mod) => function __require() {
    try {
      return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
    } catch (e) {
      throw mod = 0, e;
    }
  };

  // functions/shared/availability.js
  var require_availability = __commonJS({
    "functions/shared/availability.js"(exports, module) {
      "use strict";
      function toMinutes(hhmm) {
        const parts = String(hhmm || "0:0").split(":");
        const h = parseInt(parts[0], 10) || 0;
        const m = parseInt(parts[1], 10) || 0;
        return h * 60 + m;
      }
      function toHHMM(mins) {
        const total = (mins % 1440 + 1440) % 1440;
        const h = Math.floor(total / 60);
        const m = total % 60;
        return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
      }
      function addMinutesToTime(hhmm, durMin) {
        return toHHMM(toMinutes(hhmm) + (durMin || 0));
      }
      function dateKeyOf(dateStr) {
        return String(dateStr || "").slice(0, 10);
      }
      function dayBoundsOf(dateKey) {
        const [y, m, d] = dateKey.split("-").map(Number);
        const next = new Date(Date.UTC(y, m - 1, d + 1));
        return { start: dateKey, end: next.toISOString().slice(0, 10) };
      }
      function computeAvailability({ bookings, staff, barberId, dow, scheduleBlocks }) {
        const wantsAny = !barberId || barberId === "any";
        const relevant = wantsAny ? bookings || [] : (bookings || []).filter((b) => b.barberId === barberId);
        const barberBusy = {};
        function addBusy(id, start, end, kind) {
          if (!id) return;
          if (!barberBusy[id]) barberBusy[id] = [];
          barberBusy[id].push({ start, end, kind });
        }
        relevant.forEach((b) => addBusy(b.barberId, b.time, addMinutesToTime(b.time, b.dur || 0), "booking"));
        const activeBarberIds = (staff || []).filter((s) => s.status === "active").map((s) => s.id);
        const relevantStaffIds = wantsAny ? activeBarberIds : activeBarberIds.filter((id) => id === barberId);
        if (typeof dow === "number") {
          (staff || []).forEach((s) => {
            if (relevantStaffIds.indexOf(s.id) === -1) return;
            const day = Array.isArray(s.schedule) ? s.schedule[dow] : null;
            if (day && day.break && day.break.start && day.break.end) {
              addBusy(s.id, day.break.start, day.break.end, "break");
            }
          });
        }
        (scheduleBlocks || []).forEach((blk) => {
          if (!blk.barberId) return;
          if (relevantStaffIds.indexOf(blk.barberId) === -1) return;
          addBusy(blk.barberId, blk.start, blk.end, "block");
        });
        return { barberBusy, activeBarberIds };
      }
      function overlaps(aStart, aEnd, bStart, bEnd, bufferMin = 0) {
        return aStart < bEnd + bufferMin && aEnd > bStart - bufferMin;
      }
      function isRangeFree(busyRanges, startHHMM, endHHMM, bufferMin = 0) {
        const s = toMinutes(startHHMM);
        const e = toMinutes(endHHMM);
        return !(busyRanges || []).some((r) => {
          const buf = r.kind === "booking" ? bufferMin : 0;
          return overlaps(s, e, toMinutes(r.start), toMinutes(r.end), buf);
        });
      }
      function isWithinOpenHours(schedule, dow, startHHMM, endHHMM) {
        const day = Array.isArray(schedule) ? schedule[dow] : null;
        if (!day || !day.open) return false;
        return toMinutes(startHHMM) >= toMinutes(day.start) && toMinutes(endHHMM) <= toMinutes(day.end);
      }
      module.exports = {
        toMinutes,
        toHHMM,
        addMinutesToTime,
        computeAvailability,
        dateKeyOf,
        dayBoundsOf,
        overlaps,
        isRangeFree,
        isWithinOpenHours
      };
    }
  });

  // functions/shared/timezone.js
  var require_timezone = __commonJS({
    "functions/shared/timezone.js"(exports, module) {
      "use strict";
      var DEFAULT_TZ = "America/Santiago";
      var DEFAULT_BUFFER_MIN = 0;
      function resolveBusinessTz(businessInfo) {
        return businessInfo && businessInfo.tz || DEFAULT_TZ;
      }
      function resolveBufferMin(businessInfo) {
        return businessInfo && Number.isFinite(businessInfo.bufferMin) ? businessInfo.bufferMin : DEFAULT_BUFFER_MIN;
      }
      function zonedInstant(dateKey, time, tz) {
        const [year, month, day] = dateKey.split("-").map(Number);
        const [hour, minute] = time.split(":").map(Number);
        const guess = Date.UTC(year, month - 1, day, hour, minute);
        const parts = new Intl.DateTimeFormat("en-US", {
          timeZone: tz,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false
        }).formatToParts(new Date(guess));
        const get = (type) => Number(parts.find((p) => p.type === type).value);
        const shownHour = get("hour") === 24 ? 0 : get("hour");
        const asIfUtc = Date.UTC(get("year"), get("month") - 1, get("day"), shownHour, get("minute"));
        return new Date(guess + (guess - asIfUtc));
      }
      function dateKeyInZone(instant, tz) {
        const parts = new Intl.DateTimeFormat("en-US", {
          timeZone: tz,
          year: "numeric",
          month: "2-digit",
          day: "2-digit"
        }).formatToParts(instant);
        const get = (type) => parts.find((p) => p.type === type).value;
        return `${get("year")}-${get("month")}-${get("day")}`;
      }
      function timeKeyInZone(instant, tz) {
        const parts = new Intl.DateTimeFormat("en-US", {
          timeZone: tz,
          hour: "2-digit",
          minute: "2-digit",
          hour12: false
        }).formatToParts(instant);
        const get = (type) => parts.find((p) => p.type === type).value;
        const hour = get("hour") === "24" ? "00" : get("hour");
        return `${hour}:${get("minute")}`;
      }
      module.exports = {
        DEFAULT_TZ,
        resolveBusinessTz,
        DEFAULT_BUFFER_MIN,
        resolveBufferMin,
        zonedInstant,
        dateKeyInZone,
        timeKeyInZone
      };
    }
  });

  // functions/shared/validate.js
  var require_validate = __commonJS({
    "functions/shared/validate.js"(exports, module) {
      "use strict";
      var EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
      function isValidBookingPayload(payload) {
        const p = payload || {};
        return typeof p.name === "string" && p.name.length > 1 && typeof p.email === "string" && EMAIL_RE.test(p.email) && typeof p.phone === "string" && p.phone.length >= 7 && typeof p.svcId === "string" && typeof p.barberId === "string" && typeof p.date === "string" && typeof p.time === "string" && typeof p.code === "string" && typeof p.club === "string" && (p.club === "member" || p.club === "guest");
      }
      module.exports = { EMAIL_RE, isValidBookingPayload };
    }
  });

  // functions/shared/status.js
  var require_status = __commonJS({
    "functions/shared/status.js"(exports, module) {
      "use strict";
      var BOOKING_STATUSES = ["pending"];
      var DEFAULT_BOOKING_STATUS = "pending";
      function isValidBookingStatus(status) {
        return BOOKING_STATUSES.indexOf(status) !== -1;
      }
      module.exports = { BOOKING_STATUSES, DEFAULT_BOOKING_STATUS, isValidBookingStatus };
    }
  });

  // functions/shared/resource.js
  var require_resource = __commonJS({
    "functions/shared/resource.js"(exports, module) {
      "use strict";
      var RESOURCE_KINDS = ["person", "space", "equipment"];
      var DAYS_PER_WEEK = 7;
      var HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
      function isValidHHMM(v) {
        return typeof v === "string" && HHMM_RE.test(v);
      }
      function isValidScheduleBreak(brk) {
        if (brk === void 0) return true;
        return brk !== null && typeof brk === "object" && isValidHHMM(brk.start) && isValidHHMM(brk.end);
      }
      function isValidScheduleDay(day) {
        if (!day || typeof day !== "object") return false;
        if (typeof day.open !== "boolean") return false;
        if (!day.open) return true;
        return isValidHHMM(day.start) && isValidHHMM(day.end) && isValidScheduleBreak(day.break);
      }
      function isValidSchedule(schedule) {
        return Array.isArray(schedule) && schedule.length === DAYS_PER_WEEK && schedule.every(isValidScheduleDay);
      }
      function isValidProfile(profile) {
        if (profile === void 0) return true;
        if (profile === null || typeof profile !== "object") return false;
        if (profile.photo !== void 0 && typeof profile.photo !== "string") return false;
        if (profile.bio !== void 0 && typeof profile.bio !== "string") return false;
        return true;
      }
      function isValidResourcePayload(data) {
        if (!data || typeof data !== "object") return false;
        if (RESOURCE_KINDS.indexOf(data.kind) === -1) return false;
        if (typeof data.name !== "string" || data.name.trim().length === 0) return false;
        if (typeof data.active !== "boolean") return false;
        if (!isValidSchedule(data.schedule)) return false;
        if (data.kind === "person") {
          if (!isValidProfile(data.profile)) return false;
        } else if (data.profile !== void 0) {
          return false;
        }
        return true;
      }
      module.exports = {
        RESOURCE_KINDS,
        DAYS_PER_WEEK,
        isValidResourcePayload,
        isValidSchedule,
        isValidScheduleDay
      };
    }
  });

  // functions/shared/index.js
  var require_index = __commonJS({
    "functions/shared/index.js"(exports, module) {
      module.exports = Object.assign(
        {},
        require_availability(),
        require_timezone(),
        require_validate(),
        require_status(),
        require_resource()
      );
    }
  });
  return require_index();
})();
