client_max_body_size 256k;

location = /healthz {
  access_log off;
  add_header Content-Type text/plain;
  return 200 "ok\n";
}

location /api/ {
  proxy_pass http://maycafe_api;
  proxy_http_version 1.1;
  proxy_connect_timeout 1s;
  proxy_next_upstream error timeout http_502 http_503 http_504;
  proxy_next_upstream_tries 2;
  proxy_set_header Host $http_host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
}

location /socket.io/ {
  proxy_pass http://maycafe_socket;
  proxy_http_version 1.1;
  proxy_connect_timeout 1s;
  proxy_next_upstream error timeout http_502 http_503 http_504;
  proxy_next_upstream_tries 2;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header Host $http_host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_read_timeout 65s;
}

location /assets/ {
  try_files $uri =404;
  expires 1y;
  add_header Cache-Control "public, immutable";
}
