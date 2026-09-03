# @typren/editor

## 0.2.1

### Patch Changes

- 2a16e28: `CollectionPanel` accepts optional `mode`/`selectedSlug` props and an `onNavigate` callback so a host can control which collection record is open (e.g. a `?record=<slug>&mode=edit` URL), mirroring the existing `onReload` convention. Omitting all three keeps the previous uncontrolled behavior. `SectionShell` and `TyprenEditor` forward the same three as `collectionMode`/`collectionSlug`/`onNavigateCollection`.
- @typren/core@0.2.1
