{{/* Copies an s3:// artifact into /opt/benchmark using the pod's S3 environment. */}}
{{- define "ballista.download" -}}
{{- $uri := index . 0 -}}
rclone copyto {{ printf ":s3:%s" (trimPrefix "s3://" $uri) | quote }} /opt/benchmark/{{ index . 1 }} --s3-provider Other --s3-env-auth --s3-endpoint "$AWS_ENDPOINT_URL" --s3-region "$AWS_REGION"
{{- end -}}
