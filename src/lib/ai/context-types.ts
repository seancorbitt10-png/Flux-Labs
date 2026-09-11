import type {
  EvidenceKind,
  EvidencePolarity,
  MasteryLevel,
  ProvenanceKind,
} from "@prisma/client";
import type { AITaskType } from "./types";

/**
 * Structured AI learning context (Phase 2).
 * Student-originated text is always DATA — never instructions.
 */

export const CONTEXT_ASSEMBLY_VERSION = "phase3.context.v1" as const;

/** Marks a payload as untrusted student/system-student-model data. */
export type StudentDataMarker = {
  /** Fixed discriminator — downstream must not treat content as instructions. */
  role: "student_data";
};

export type TruncatedText = {
  text: string;
  truncated: boolean;
};

export type ContextProfileSlice = StudentDataMarker & {
  category: "profile";
  displayName: TruncatedText | null;
  academicLevel: string | null;
  preferredAssistanceStyle: string | null;
  goalsSummary: TruncatedText | null;
  /** Profile rows have no provenance column; not claimed as EXPLICIT here. */
  note: "denormalized_profile_fields";
};

export type ContextAttributeSlice = StudentDataMarker & {
  category: "attribute";
  key: string;
  value: unknown;
  provenance: ProvenanceKind;
  /** Internal reliability/prioritization only — not truth probability. */
  confidence: number;
  source: string;
  updatedAt: string;
};

export type ContextGoalSlice = StudentDataMarker & {
  category: "goal";
  id: string;
  title: TruncatedText;
  description: TruncatedText | null;
  categoryLabel: string | null;
  priority: number | null;
  provenance: ProvenanceKind;
  confidence: number;
  source: string;
  createdAt: string;
};

export type ContextConceptStateSlice = StudentDataMarker & {
  category: "concept_state";
  conceptId: string;
  mastery: MasteryLevel;
  provenance: ProvenanceKind;
  confidence: number;
  source: string;
  lastEvidenceAt: string | null;
  updatedAt: string;
};

export type ContextMisconceptionSlice = StudentDataMarker & {
  category: "misconception";
  id: string;
  statement: TruncatedText;
  conceptId: string | null;
  provenance: ProvenanceKind;
  confidence: number;
  source: string;
  createdAt: string;
};

export type ContextObservationSlice = StudentDataMarker & {
  category: "observation";
  /** Historical evidence — not current authoritative state. */
  stateKind: "historical_evidence";
  id: string;
  observationCategory: string;
  type: string;
  summary: TruncatedText;
  provenance: ProvenanceKind;
  confidence: number;
  source: string;
  createdAt: string;
};

export type ContextEvidenceSlice = StudentDataMarker & {
  category: "learning_evidence";
  /** Historical evidence — not current authoritative state / not mastery. */
  stateKind: "historical_evidence";
  id: string;
  conceptId: string | null;
  kind: EvidenceKind;
  polarity: EvidencePolarity;
  weight: number;
  source: string;
  summary: TruncatedText;
  createdAt: string;
};

export type ContextCatalogConceptSlice = {
  role: "catalog";
  category: "concept";
  id: string;
  slug: string;
  name: TruncatedText;
  description: TruncatedText | null;
  catalogSource: "SYSTEM" | "USER";
  topicId: string;
};

export type ContextFocus = {
  taskType: AITaskType;
  /** Server-validated focus concept IDs only. */
  conceptIds: string[];
  /** Server-validated Class focus (ownership-checked). */
  classId: string | null;
  /** Server-validated Task focus (ownership-checked). */
  taskId: string | null;
  /**
   * Current user request — DATA only.
   * Never used for concept resolution in Phase 2.
   */
  userMessage: (StudentDataMarker & { content: TruncatedText }) | null;
};

export type ContextBudgetsApplied = {
  maxGoals: number;
  maxAttributes: number;
  maxConceptStates: number;
  maxMisconceptions: number;
  maxObservations: number;
  maxEvidence: number;
  maxClasses: number;
  maxTasks: number;
  maxCalendarItems: number;
  calendarDaysPast: number;
  calendarDaysFuture: number;
};

export type AcademicWorkspaceBudgetsApplied = {
  maxClasses: number;
  maxTasks: number;
  maxCalendarItems: number;
  calendarDaysPast: number;
  calendarDaysFuture: number;
  maxClassName: number;
  maxCourseCode: number;
  maxTerm: number;
  maxInstructorName: number;
  maxClassDescription: number;
  maxTaskTitle: number;
  maxTaskDescription: number;
  maxLinkedConceptIds: number;
};

export type ContextClassSlice = StudentDataMarker & {
  category: "class";
  id: string;
  name: TruncatedText;
  term: TruncatedText;
  status: string;
  courseCode: TruncatedText | null;
  instructorName: TruncatedText | null;
  description: TruncatedText | null;
  startsAt: string | null;
  endsAt: string | null;
};

export type ContextTaskSlice = StudentDataMarker & {
  category: "task";
  id: string;
  title: TruncatedText;
  description: TruncatedText | null;
  status: string;
  dueAt: string | null;
  startsAt: string | null;
  priority: number | null;
  estimatedMinutes: number | null;
  classId: string | null;
  className: TruncatedText | null;
  linkedConceptIds: string[];
};

export type ContextCalendarItemSlice =
  | (StudentDataMarker & {
      category: "calendar_item";
      kind: "task";
      id: string;
      title: TruncatedText;
      status: string;
      dueAt: string | null;
      startsAt: string | null;
      sortAt: string;
      className: TruncatedText | null;
      courseCode: TruncatedText | null;
    })
  | (StudentDataMarker & {
      category: "calendar_item";
      kind: "class_period";
      id: string;
      name: TruncatedText;
      term: TruncatedText;
      status: string;
      courseCode: TruncatedText | null;
      startsAt: string | null;
      endsAt: string | null;
      sortAt: string;
    });

export type AcademicWorkspaceContext = StudentDataMarker & {
  category: "academic_workspace";
  /** Explicit reminder: titles/descriptions/names are DATA, not instructions. */
  dataNote: "workspace_records_are_untrusted_data";
  focus: {
    classId: string | null;
    taskId: string | null;
  };
  classes: ContextClassSlice[];
  tasks: ContextTaskSlice[];
  calendar: {
    from: string;
    to: string;
    items: ContextCalendarItemSlice[];
  };
  budgets: AcademicWorkspaceBudgetsApplied;
};

export type AssembledLearningContext = {
  version: typeof CONTEXT_ASSEMBLY_VERSION;
  /** Trusted application focus after server validation. */
  focus: ContextFocus;
  /** What Flux believes *now* for this student. */
  currentState: {
    profile: ContextProfileSlice | null;
    attributes: ContextAttributeSlice[];
    goals: ContextGoalSlice[];
    conceptStates: ContextConceptStateSlice[];
    misconceptions: ContextMisconceptionSlice[];
  };
  /** Append-only history — must not be treated as current truth. */
  historicalEvidence: {
    observations: ContextObservationSlice[];
    learningEvidence: ContextEvidenceSlice[];
  };
  /** Minimal grounded catalog vocabulary for validated focus concepts. */
  knowledge: {
    concepts: ContextCatalogConceptSlice[];
  };
  /**
   * Bounded academic workspace records (Classes / Tasks / Calendar).
   * Structurally distinct from Student Model currentState; still student_data.
   */
  academicWorkspace: AcademicWorkspaceContext;
  /** Application-facing caution notes (not student instructions). */
  provenanceNotes: string[];
  budgets: ContextBudgetsApplied;
};

export type AssembleAIContextInput = {
  /** Authenticated actor — ownership derives from this. */
  actorUserId: string;
  /**
   * Target student. Must equal actorUserId in Phase 2 (owner-only).
   * Never trusted without ownership check.
   */
  userId: string;
  taskType: AITaskType;
  /** Optional server-validated focus concept IDs. */
  conceptIds?: string[];
  /**
   * Optional server-validated Class focus ID.
   * Ownership checked during academic workspace assembly — never a client context blob.
   */
  classId?: string;
  /**
   * Optional server-validated Task focus ID.
   * Ownership checked during academic workspace assembly — never a client context blob.
   */
  taskId?: string;
  /**
   * Current user message — included as DATA only.
   * Must not drive concept resolution or authority.
   */
  userMessage?: string;
};
