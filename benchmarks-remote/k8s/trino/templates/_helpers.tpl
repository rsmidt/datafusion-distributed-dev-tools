{{/*
Starts Trino with its heap at 70% of the memory the container can use (its
limit, or the node's allocatable memory) and per-node query memory and
headroom derived from that heap.
*/}}
{{- define "trino.sizedLauncher" -}}
command:
  - bash
  - -c
  - |
    heap=$((MEMORY_MB * 70 / 100))
    export TRINO_QUERY_MEMORY_PER_NODE=$((heap * 80 / 100))MB TRINO_HEAP_HEADROOM=$((heap * 15 / 100))MB
    exec /usr/lib/trino/bin/launcher run --etc-dir /etc/trino -J "-Xmx${heap}M"
env:
  - name: MEMORY_MB
    valueFrom:
      resourceFieldRef: {resource: limits.memory, divisor: 1Mi}
{{- end -}}
