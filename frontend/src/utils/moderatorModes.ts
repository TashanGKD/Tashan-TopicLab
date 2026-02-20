import type { AssignableModeratorMode } from '../api/client'
import {
  groupBySourceAndCategory,
  getSectionId,
  createFilterBySearch,
  sourceDisplayName,
} from './resourceUtils'

export { groupBySourceAndCategory, sourceDisplayName }

const filterModeratorModesBySearchImpl = createFilterBySearch<AssignableModeratorMode>((m) => [
  m.name,
  m.description,
  m.category_name,
  m.category,
  m.source,
  m.convergence_strategy,
])
export const filterModeratorModesBySearch = filterModeratorModesBySearchImpl

export const getModeratorModeSectionId = getSectionId
