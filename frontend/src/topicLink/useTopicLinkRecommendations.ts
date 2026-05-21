import { useCallback, useEffect, useState } from 'react'
import { topicsApi, TopicLinkSimulationResponse, TopicListItem } from '../api/client'
import { TopicViewerProfile } from '../data/topicViewerProfiles'
import {
  buildLocalTopicLinkSimulation,
  getTopicDisplayTitle,
  getTopicLinkScoreCandidates,
  getWantedTitle,
  TopicLinkRecommendationMap,
  TopicLinkRuntimeStatus,
} from './topicLinkModel'
import { buildTopicLinkSkillSearchText } from './topicLinkSkill'

export function useTopicLinkRecommendations({
  selectedTopic,
  candidateTopics = [],
  viewerProfile,
  skillQuery,
}: {
  selectedTopic: TopicListItem | null
  candidateTopics?: TopicListItem[]
  viewerProfile?: TopicViewerProfile
  skillQuery?: string
}) {
  const [recommendations, setRecommendations] = useState<TopicLinkRecommendationMap>({})
  const [runtimeStatus, setRuntimeStatus] = useState<TopicLinkRuntimeStatus>({
    vectorStatus: 'idle',
    embeddingModel: 'Qwen3-Embedding-8B',
  })
  const [loading, setLoading] = useState(false)
  const [simulation, setSimulation] = useState<TopicLinkSimulationResponse | null>(null)
  const [simulationLoading, setSimulationLoading] = useState(false)
  const candidateSignature = candidateTopics.map((topic) => topic.id).join('|')
  const useSkillProfile = Boolean(viewerProfile || skillQuery?.trim())
  const selectedTopicRequestId = useSkillProfile ? '' : selectedTopic?.id

  useEffect(() => {
    if ((!useSkillProfile && !selectedTopic?.id) || (useSkillProfile && candidateTopics.length === 0)) {
      setRecommendations({})
      setRuntimeStatus({
        vectorStatus: 'idle',
        embeddingModel: 'Qwen3-Embedding-8B',
      })
      setLoading(false)
      return
    }
    setSimulation(null)
    let cancelled = false
    setLoading(true)
    const candidates = getTopicLinkScoreCandidates(useSkillProfile ? null : selectedTopic, candidateTopics)
    const skillProfileText = buildTopicLinkSkillSearchText({ viewerProfile, query: skillQuery })
    const request = useSkillProfile && candidates.length > 0
      ? topicsApi.scoreTopicLinkRecommendations({
        profile_text: skillProfileText,
        topics: candidates,
      })
      : topicsApi.getTopicLinkRecommendations({ topicId: selectedTopic?.id, limit: 32 })
    void request
      .then((res) => {
        if (cancelled) return
        setRecommendations(Object.fromEntries(res.data.items.map((item) => [item.topic_id, item])))
        setRuntimeStatus({
          vectorStatus: res.data.vector_status,
          embeddingModel: res.data.embedding_model,
          message: res.data.message,
        })
      })
      .catch(() => {
        if (cancelled) return
        setRuntimeStatus({
          vectorStatus: 'failed',
          embeddingModel: 'Qwen3-Embedding-8B',
          message: '相近度推荐暂不可用。',
        })
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [candidateSignature, selectedTopicRequestId, skillQuery, viewerProfile?.username])

  const simulate = useCallback(async (topic: TopicListItem) => {
    setSimulationLoading(true)
    if (viewerProfile) {
      setSimulation(buildLocalTopicLinkSimulation(topic, viewerProfile))
    } else {
      setSimulation({
        provider_status: 'local',
        model: 'local-preview',
        summary: '先看大家已经聊到哪一步。',
        turns: [
          {
            speaker: '分身',
            role: getWantedTitle(topic),
            message: `我先把「${getTopicDisplayTitle(topic)}」的背景和回应读一遍，再决定从哪里接一句。`,
          },
        ],
        suggested_action: '先看清楚，再回应。',
      })
    }
    try {
      const profileText = buildTopicLinkSkillSearchText({ viewerProfile, query: skillQuery })
      const res = await topicsApi.simulateTopicLink(
        topic.id,
        viewerProfile || skillQuery?.trim()
          ? {
              profile_text: profileText,
              persona_name: viewerProfile?.agentName,
            }
          : undefined,
      )
      if (res.data.provider_status === 'ready') {
        setSimulation(res.data)
      } else if (viewerProfile) {
        setSimulation(buildLocalTopicLinkSimulation(topic, viewerProfile))
      } else {
        setSimulation(res.data)
      }
    } catch {
      setSimulation(
        viewerProfile
          ? buildLocalTopicLinkSimulation(topic, viewerProfile)
          : {
              provider_status: 'failed',
              model: 'MiniMax-M2.5',
              summary: '现在先给一个保守判断。',
              turns: [
                {
                  speaker: '分身',
                  role: getWantedTitle(topic),
                  message: `我想先了解「${getTopicDisplayTitle(topic)}」，看看现在适不适合开口。`,
                },
              ],
              suggested_action: '先看清楚，再决定是否回应。',
              message: '先给一个保守判断。',
            },
      )
    } finally {
      setSimulationLoading(false)
    }
  }, [skillQuery, viewerProfile])

  return {
    recommendations,
    runtimeStatus,
    loading,
    simulation,
    simulationLoading,
    simulate,
  }
}
