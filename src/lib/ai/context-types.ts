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

export const CONTEXT_ASSEMBLY_VERSION = "phase2.context.v1" as const;

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
   * Current user message — included as DATA only.
   * Must not drive concept resolution or authority.
   */
  userMessage?: string;
};
