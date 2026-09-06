export {
  ATTRIBUTE_REGISTRY,
  assertRegisteredAttributeKey,
  assertWriterAllowed,
  getAttributeDefinition,
  rejectClientAuthorityFields,
  validateAttributeValue,
  type AttributeRegistryEntry,
  type AttributeWriter,
  type RegisteredAttributeKey,
} from "./attribute-registry";

export {
  setStudentAttribute,
  getActiveAttribute,
  listActiveAttributes,
  getAttributeHistory,
  assertNoDirectAttributeClientWrite,
} from "./attributes";
export { applyClientAttributeUpdate } from "./client-attributes";

export { createStudentGoal, listStudentGoals, updateStudentGoalStatus, upsertStudentGoalByCategory } from "./goals";
export {
  getStudentProfile,
  ensureStudentProfile,
  updateStudentProfile,
} from "./profile";
export {
  recordStudentObservation,
  listStudentObservations,
} from "./observations";
export {
  recordLearningEvidence,
  listLearningEvidence,
} from "./evidence";
export {
  upsertExplicitConceptState,
  getConceptState,
  listConceptStates,
} from "./concept-state";
export {
  createStudentMisconception,
  updateMisconceptionStatus,
  listMisconceptions,
} from "./misconceptions";
export { deleteUserEducationalData, deleteUserAccount } from "./deletion";
