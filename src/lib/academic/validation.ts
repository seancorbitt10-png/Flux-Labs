import type { ClassStatus, TaskStatus } from "@prisma/client";
import { z } from "zod";

export const MAX_CLASS_NAME = 120;
export const MAX_TERM = 80;
export const MAX_COURSE_CODE = 40;
export const MAX_INSTRUCTOR_NAME = 120;
export const MAX_DESCRIPTION = 5_000;
export const MAX_TASK_TITLE = 300;
export const MAX_PRIORITY = 5;
export const MIN_PRIORITY = 1;
export const MAX_ESTIMATED_MINUTES = 10_080; // 7 days
export const MAX_TASK_CONCEPTS = 20;
export const MAX_CALENDAR_RESULTS = 500;

const classStatusSchema = z.enum(["ACTIVE", "ARCHIVED"]);
const taskStatusSchema = z.enum([
  "TODO",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
]);

function optionalTrimmedString(max: number) {
  return z
    .union([z.string(), z.null(), z.undefined()])
    .transform((v) => {
      if (v == null) return null;
      const t = v.trim();
      return t.length === 0 ? null : t;
    })
    .refine((v) => v === null || v.length <= max, {
      message: `Must be at most ${max} characters.`,
    });
}

function optionalDate() {
  return z
    .union([z.date(), z.string().datetime(), z.null(), z.undefined()])
    .transform((v, ctx) => {
      if (v == null || v === undefined) return null;
      if (v instanceof Date) {
        if (Number.isNaN(v.getTime())) {
          ctx.addIssue({ code: "custom", message: "Invalid date." });
          return z.NEVER;
        }
        return v;
      }
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) {
        ctx.addIssue({ code: "custom", message: "Invalid date." });
        return z.NEVER;
      }
      return d;
    });
}

export const createClassInputSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Class name is required")
      .max(MAX_CLASS_NAME, "Class name is too long"),
    term: z
      .string()
      .trim()
      .min(1, "Term is required")
      .max(MAX_TERM, "Term is too long"),
    courseCode: optionalTrimmedString(MAX_COURSE_CODE).optional(),
    instructorName: optionalTrimmedString(MAX_INSTRUCTOR_NAME).optional(),
    description: optionalTrimmedString(MAX_DESCRIPTION).optional(),
    startsAt: optionalDate().optional(),
    endsAt: optionalDate().optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.startsAt && data.endsAt && data.startsAt > data.endsAt) {
      ctx.addIssue({
        code: "custom",
        message: "Class start must be on or before end.",
        path: ["endsAt"],
      });
    }
  });

export const updateClassInputSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Class name is required")
      .max(MAX_CLASS_NAME, "Class name is too long")
      .optional(),
    term: z
      .string()
      .trim()
      .min(1, "Term is required")
      .max(MAX_TERM, "Term is too long")
      .optional(),
    status: classStatusSchema.optional(),
    courseCode: optionalTrimmedString(MAX_COURSE_CODE).optional(),
    instructorName: optionalTrimmedString(MAX_INSTRUCTOR_NAME).optional(),
    description: optionalTrimmedString(MAX_DESCRIPTION).optional(),
    startsAt: optionalDate().optional(),
    endsAt: optionalDate().optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (
      data.startsAt instanceof Date &&
      data.endsAt instanceof Date &&
      data.startsAt > data.endsAt
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Class start must be on or before end.",
        path: ["endsAt"],
      });
    }
  });

export const createTaskInputSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, "Task title is required")
      .max(MAX_TASK_TITLE, "Task title is too long"),
    description: optionalTrimmedString(MAX_DESCRIPTION).optional(),
    classId: z
      .union([z.string().trim().min(1).max(64), z.null(), z.undefined()])
      .transform((v) => (v == null || v === "" ? null : v))
      .optional(),
    status: taskStatusSchema.optional(),
    dueAt: optionalDate().optional(),
    startsAt: optionalDate().optional(),
    priority: z
      .union([z.number().int(), z.null(), z.undefined()])
      .refine(
        (v) =>
          v == null ||
          (typeof v === "number" && v >= MIN_PRIORITY && v <= MAX_PRIORITY),
        { message: `Priority must be between ${MIN_PRIORITY} and ${MAX_PRIORITY}.` },
      )
      .transform((v) => (v == null ? null : v))
      .optional(),
    estimatedMinutes: z
      .union([z.number().int(), z.null(), z.undefined()])
      .refine(
        (v) =>
          v == null ||
          (typeof v === "number" && v >= 1 && v <= MAX_ESTIMATED_MINUTES),
        {
          message: `Estimated minutes must be between 1 and ${MAX_ESTIMATED_MINUTES}.`,
        },
      )
      .transform((v) => (v == null ? null : v))
      .optional(),
    conceptIds: z
      .array(z.string().trim().min(1).max(64))
      .max(MAX_TASK_CONCEPTS)
      .optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.startsAt && data.dueAt && data.startsAt > data.dueAt) {
      ctx.addIssue({
        code: "custom",
        message: "Task start must be on or before due date.",
        path: ["dueAt"],
      });
    }
    if (data.conceptIds) {
      const set = new Set(data.conceptIds);
      if (set.size !== data.conceptIds.length) {
        ctx.addIssue({
          code: "custom",
          message: "Duplicate concept IDs are not allowed.",
          path: ["conceptIds"],
        });
      }
    }
  });

export const updateTaskInputSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, "Task title is required")
      .max(MAX_TASK_TITLE, "Task title is too long")
      .optional(),
    description: optionalTrimmedString(MAX_DESCRIPTION).optional(),
    classId: z
      .union([z.string().trim().min(1).max(64), z.null()])
      .optional(),
    status: taskStatusSchema.optional(),
    dueAt: optionalDate().optional(),
    startsAt: optionalDate().optional(),
    priority: z
      .union([z.number().int(), z.null()])
      .refine(
        (v) =>
          v === null ||
          (typeof v === "number" && v >= MIN_PRIORITY && v <= MAX_PRIORITY),
        { message: `Priority must be between ${MIN_PRIORITY} and ${MAX_PRIORITY}.` },
      )
      .optional(),
    estimatedMinutes: z
      .union([z.number().int(), z.null()])
      .refine(
        (v) =>
          v === null ||
          (typeof v === "number" && v >= 1 && v <= MAX_ESTIMATED_MINUTES),
        {
          message: `Estimated minutes must be between 1 and ${MAX_ESTIMATED_MINUTES}.`,
        },
      )
      .optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (
      data.startsAt instanceof Date &&
      data.dueAt instanceof Date &&
      data.startsAt > data.dueAt
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Task start must be on or before due date.",
        path: ["dueAt"],
      });
    }
  });

export const taskConceptIdsSchema = z
  .object({
    conceptIds: z
      .array(z.string().trim().min(1).max(64))
      .min(1)
      .max(MAX_TASK_CONCEPTS),
  })
  .strict()
  .superRefine((data, ctx) => {
    const set = new Set(data.conceptIds);
    if (set.size !== data.conceptIds.length) {
      ctx.addIssue({
        code: "custom",
        message: "Duplicate concept IDs are not allowed.",
        path: ["conceptIds"],
      });
    }
  });

export const calendarQuerySchema = z
  .object({
    from: z.union([z.date(), z.string().datetime()]).transform((v, ctx) => {
      const d = v instanceof Date ? v : new Date(v);
      if (Number.isNaN(d.getTime())) {
        ctx.addIssue({ code: "custom", message: "Invalid from date." });
        return z.NEVER;
      }
      return d;
    }),
    to: z.union([z.date(), z.string().datetime()]).transform((v, ctx) => {
      const d = v instanceof Date ? v : new Date(v);
      if (Number.isNaN(d.getTime())) {
        ctx.addIssue({ code: "custom", message: "Invalid to date." });
        return z.NEVER;
      }
      return d;
    }),
    classId: z.string().trim().min(1).max(64).optional().nullable(),
    status: taskStatusSchema.optional(),
    limit: z.number().int().min(1).max(MAX_CALENDAR_RESULTS).optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.from > data.to) {
      ctx.addIssue({
        code: "custom",
        message: "Calendar from must be on or before to.",
        path: ["to"],
      });
    }
  });

export type CreateClassInputParsed = z.infer<typeof createClassInputSchema>;
export type UpdateClassInputParsed = z.infer<typeof updateClassInputSchema>;
export type CreateTaskInputParsed = z.infer<typeof createTaskInputSchema>;
export type UpdateTaskInputParsed = z.infer<typeof updateTaskInputSchema>;
export type CalendarQueryParsed = z.infer<typeof calendarQuerySchema>;

export type { ClassStatus, TaskStatus };
