import type { AssignableMCP } from '../api/client'
import {
  groupBySourceAndCategory,
  getSectionId,
  createFilterBySearch,
  sourceDisplayName,
} from './resourceUtils'

export { groupBySourceAndCategory, sourceDisplayName }

const filterMcpsBySearchImpl = createFilterBySearch<AssignableMCP>((m) => [
  m.name,
  m.description,
  m.category_name,
  m.category,
  m.source,
])
export const filterMcpsBySearch = filterMcpsBySearchImpl

export const getMcpSectionId = getSectionId
