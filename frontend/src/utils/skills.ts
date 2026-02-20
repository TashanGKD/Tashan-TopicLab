import type { AssignableSkill } from '../api/client'
import {
  groupBySourceAndCategory,
  getSectionId,
  createFilterBySearch,
  sourceDisplayName,
} from './resourceUtils'

export { groupBySourceAndCategory, sourceDisplayName }

const filterSkillsBySearchImpl = createFilterBySearch<AssignableSkill>((s) => [
  s.name,
  s.description,
  s.category_name,
  s.category,
  s.source,
])
export const filterSkillsBySearch = filterSkillsBySearchImpl

export const getSkillSectionId = getSectionId
