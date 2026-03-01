# Share to Expert / Moderator Mode Library — Sequence Diagrams

## 1. Expert Share (Share to Expert Library)

```mermaid
sequenceDiagram
    autonumber
    participant User
    participant ExpertMgmt as ExpertManagement
    participant API as topicExpertsApi
    participant Backend as topic_experts API
    participant Workspace as workspace/topics/{id}
    participant Libs as libs/experts/topiclab_shared
    participant Reload as reload_expert_specs

    User->>ExpertMgmt: Click "Share to Expert Library"
    ExpertMgmt->>User: confirm dialog
    User->>ExpertMgmt: Confirm
    ExpertMgmt->>API: share(topicId, expert.name)
    API->>Backend: POST /topics/{id}/experts/{name}/share

    Backend->>Backend: Validate topic exists
    Backend->>Backend: Validate not built-in (source≠default)
    Backend->>Workspace: Read agents/{name}/role.md
    Backend->>Workspace: Read config/experts_metadata.json
    Workspace-->>Backend: role content + metadata

    Backend->>Libs: Write {name}.md
    Backend->>Libs: Update meta.json (experts entry)
    Backend->>Reload: reload_expert_specs()
    Reload->>Libs: load_aggregated_experts_meta
    Reload->>Reload: EXPERT_SPECS.clear() + update()
    Backend->>Backend: invalidate_libs_cache()

    Backend-->>API: 200 { message, expert_name }
    API-->>ExpertMgmt: Success
    ExpertMgmt->>ExpertMgmt: loadExperts() refresh topic experts
    ExpertMgmt->>User: handleApiSuccess "Shared to platform"
```

---

## 2. Moderator Mode Share (Share to Moderator Mode Library)

```mermaid
sequenceDiagram
    autonumber
    participant User
    participant TopicConfig as TopicConfigTabs
    participant ShareDialog
    participant API as moderatorModesApi
    participant Backend as moderator_modes API
    participant Workspace as workspace/topics/{id}/config
    participant Libs as libs/moderator_modes/topiclab_shared
    participant Reload as reload_moderator_modes

    User->>TopicConfig: Click "Share to Moderator Mode Library" in custom mode dialog
    TopicConfig->>ShareDialog: Open share dialog
    User->>ShareDialog: Enter mode_id, name, description
    User->>ShareDialog: Click "Confirm Share"
    ShareDialog->>API: share(topicId, { mode_id, name?, description? })
    API->>Backend: POST /topics/{id}/moderator-mode/share

    Backend->>Workspace: Read config/moderator_mode.json
    Backend->>Backend: Validate mode_id=custom and custom_prompt exists
    Backend->>Backend: Validate mode_id does not conflict with built-in

    Backend->>Libs: Write {mode_id}.md (custom_prompt content)
    Backend->>Libs: Update meta.json (modes entry)
    Backend->>Reload: reload_moderator_modes()
    Reload->>Libs: get_modes_and_common
    Reload->>Reload: PRESET_MODES.clear() + update()
    Backend->>Backend: invalidate_libs_cache()

    Backend-->>API: 200 { message, mode_id }
    API-->>ShareDialog: Success
    ShareDialog->>ShareDialog: Close dialog
    ShareDialog->>API: listAssignable() refresh moderator modes
    ShareDialog->>User: handleApiSuccess "Shared to Moderator Mode Library"
```

---

## 3. Key Steps Summary

| Step | Expert Share | Moderator Mode Share |
|------|--------------|----------------------|
| Data source | `workspace/topics/{id}/agents/{name}/role.md` | `custom_prompt` from `workspace/topics/{id}/config/moderator_mode.json` |
| Write target | `libs/experts/topiclab_shared/{name}.md` | `libs/moderator_modes/topiclab_shared/{mode_id}.md` |
| Metadata | `topiclab_shared/meta.json` → `experts` | `topiclab_shared/meta.json` → `modes` |
| Category | `category: topiclab` | `category: topiclab` |
| In-memory reload | `reload_expert_specs()` in-place updates `EXPERT_SPECS` | `reload_moderator_modes()` in-place updates `PRESET_MODES` |
| Cache | `invalidate_libs_cache()` | Same |

---

## 4. Persistence

With Docker, `libs` is mounted as `./backend/libs`. User-shared content written to `topiclab_shared/` persists on the host; it remains available after container restarts.
