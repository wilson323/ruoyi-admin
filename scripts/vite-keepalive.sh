#!/usr/bin/env bash
# vite-keepalive.sh
# ----------------------------------------------------------------------------
# A5 守护脚本:根除 vite dev server 挂死无监控问题(R37 — PID 84577 STAT=TN 挂死 6h+)
#
# 根因:macOS 下 nohup 直起 vite 会卡 read syscall(事件循环锁死)→ STAT=T/TN
# 方案:正确方式启动 + STAT 监测 + 自动重启
#
# 用法:
#   ./scripts/vite-keepalive.sh start    # 启动 vite + 后台守护(每 60s 检查)
#   ./scripts/vite-keepalive.sh status   # 单次健康检查
#   ./scripts/vite-keepalive.sh restart  # kill 旧进程 + 重启 vite
#   ./scripts/vite-keepalive.sh stop     # 停守护(vite 保留)
# ----------------------------------------------------------------------------
set -euo pipefail

# ============ 配置(可被环境变量覆盖)===========================================
VITE_ROOT="${VITE_ROOT:-/Users/mac/Documents/ruoyi-ipd-web}"
VITE_ENTRY="${VITE_ENTRY:-node node_modules/vite/bin/vite.js apps/web-antd --config apps/web-antd/vite.config.mts}"
VITE_LOG="${VITE_LOG:-/tmp/vite.log}"
KEEPALIVE_PID_FILE="${KEEPALIVE_PID_FILE:-/tmp/vite-keepalive.pid}"
KEEPALIVE_LOG="${KEEPALIVE_LOG:-/tmp/vite-keepalive.log}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:15666/}"
HEALTH_PORT="${HEALTH_PORT:-15666}"
CHECK_INTERVAL="${CHECK_INTERVAL:-60}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-5}"
MIN_BODY_SIZE="${MIN_BODY_SIZE:-100}"
STARTUP_GRACE="${STARTUP_GRACE:-30}"

# ============ 工具函数 ========================================================
ts()   { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
log()  { printf '[%s] %s\n' "$(ts)" "$*" >> "$KEEPALIVE_LOG" 2>/dev/null || true; }
jout() { printf '%s\n' "$1"; }

is_dead_stat() {
  local stat="$1"
  [[ "$stat" == *T* ]]
}

pid_on_port() {
  lsof -nP -iTCP:"$HEALTH_PORT" -sTCP:LISTEN -t 2>/dev/null | head -1
}

stat_of() {
  local pid="$1"
  ps -p "$pid" -o stat= 2>/dev/null | tr -d ' '
}

check_health() {
  local out http size
  out=$(curl -sS --max-time "$HEALTH_TIMEOUT" -o - -w $'\n__HTTP=%{http_code}__SIZE=%{size_download}' \
    "$HEALTH_URL" 2>/dev/null || echo '__HTTP=000__SIZE=0')
  http=$(printf '%s' "$out" | awk -F'__HTTP=' '/__HTTP=/{print $2}' | awk -F'__SIZE=' '{print $1}' | tail -1)
  size=$(printf '%s' "$out" | awk -F'__SIZE=' '/__SIZE=/{print $2}' | tail -1)
  http="${http:-000}"; size="${size:-0}"
  if [[ "$http" == "200" ]] && [[ "$size" -ge "$MIN_BODY_SIZE" ]]; then
    echo "OK|$http|$size"
  else
    echo "FAIL|$http|$size"
  fi
}

emit_status() {
  local action="$1" pid stat healthy
  pid=$(pid_on_port || true)
  if [[ -n "$pid" ]] && [[ "$pid" =~ ^[0-9]+$ ]]; then
    stat=$(stat_of "$pid"); stat="${stat:-Z}"
    local probe
    probe=$(check_health)
    case "$probe" in
      OK*)   healthy=true ;;
      *)     healthy=false ;;
    esac
  else
    stat="NOPID"; healthy=false
  fi
  jout "{\"action\":\"$action\",\"pid\":${pid:-0},\"stat\":\"$stat\",\"healthy\":$healthy,\"timestamp\":\"$(ts)\"}"
}

kill_port() {
  local p
  p=$(pid_on_port || true)
  if [[ -n "$p" ]] && [[ "$p" =~ ^[0-9]+$ ]]; then
    log "kill port=$HEALTH_PORT pid=$p"
    kill -9 "$p" 2>/dev/null || true
    sleep 1
  fi
}

start_vite() {
  log "start vite root=$VITE_ROOT"
  (
    cd "$VITE_ROOT"
    nohup $VITE_ENTRY > "$VITE_LOG" 2>&1 &
    disown
  )
  sleep 2
  for _ in $(seq 1 15); do
    if pid_on_port >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  return 1
}

# 守护主循环(独立 source,避免 declare -f 子 shell 边界)
daemon_loop() {
  log "daemon start interval=${CHECK_INTERVAL}s grace=${STARTUP_GRACE}s"
  local since_start=0
  while true; do
    sleep "$CHECK_INTERVAL"
    local pid
    pid=$(pid_on_port || true)
    if [[ -z "$pid" ]]; then
      log "no pid on port $HEALTH_PORT - restart"
      start_vite || log "start_vite FAILED"
      since_start=0
      continue
    fi
    local stat
    stat=$(stat_of "$pid")
    if is_dead_stat "$stat"; then
      log "DEAD pid=$pid stat=$stat - kill+restart"
      kill -9 "$pid" 2>/dev/null || true
      sleep 1
      kill_port
      start_vite || log "start_vite FAILED after dead"
      since_start=0
      continue
    fi
    since_start=$((since_start + CHECK_INTERVAL))
    if (( since_start >= STARTUP_GRACE )); then
      local probe
      probe=$(check_health)
      case "$probe" in
        OK*)
          log "healthy pid=$pid stat=$stat"
          ;;
        *)
          log "UNHEALTHY pid=$pid stat=$stat probe=$probe - restart"
          kill -9 "$pid" 2>/dev/null || true
          sleep 1
          kill_port
          start_vite || log "start_vite FAILED after unhealthy"
          since_start=0
          ;;
      esac
    fi
  done
}

# ============ 守护子进程:独立 bash 子 shell =================================
# 写到临时 .sh 文件再 source + nohup,避免 declare -f 边界问题
DAEMON_BODY_FILE="${DAEMON_BODY_FILE:-/tmp/vite-keepalive-daemon.sh}"

write_daemon_body() {
  cat > "$DAEMON_BODY_FILE" <<BODYEOF
#!/usr/bin/env bash
# 自动生成的守护函数体(由 vite-keepalive.sh 写出)
# 环境变量:CHECK_INTERVAL HEALTH_TIMEOUT MIN_BODY_SIZE STARTUP_GRACE
#           HEALTH_URL HEALTH_PORT KEEPALIVE_LOG VITE_ROOT VITE_ENTRY VITE_LOG
ts()   { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
log()  { printf '[%s] %s\n' "\$(ts)" "\$*" >> "$KEEPALIVE_LOG" 2>/dev/null || true; }
is_dead_stat() {
  local stat="\$1"
  [[ "\$stat" == *T* ]]
}
pid_on_port() {
  lsof -nP -iTCP:"$HEALTH_PORT" -sTCP:LISTEN -t 2>/dev/null | head -1
}
stat_of() {
  local pid="\$1"
  ps -p "\$pid" -o stat= 2>/dev/null | tr -d ' '
}
check_health() {
  local out http size
  out=\$(curl -sS --max-time "$HEALTH_TIMEOUT" -o - -w \$'\\n__HTTP=%{http_code}__SIZE=%{size_download}' \\
    "$HEALTH_URL" 2>/dev/null || echo '__HTTP=000__SIZE=0')
  http=\$(printf '%s' "\$out" | awk -F'__HTTP=' '/__HTTP=/{print \$2}' | awk -F'__SIZE=' '{print \$1}' | tail -1)
  size=\$(printf '%s' "\$out" | awk -F'__SIZE=' '/__SIZE=/{print \$2}' | tail -1)
  http="\${http:-000}"; size="\${size:-0}"
  if [[ "\$http" == "200" ]] && [[ "\$size" -ge "$MIN_BODY_SIZE" ]]; then
    echo "OK|\$http|\$size"
  else
    echo "FAIL|\$http|\$size"
  fi
}
start_vite() {
  log "start vite root=$VITE_ROOT"
  ( cd "$VITE_ROOT"; nohup $VITE_ENTRY > "$VITE_LOG" 2>&1 & disown )
  sleep 2
  for _ in \$(seq 1 15); do
    if pid_on_port >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  return 1
}
kill_port() {
  local p
  p=\$(pid_on_port || true)
  if [[ -n "\$p" ]] && [[ "\$p" =~ ^[0-9]+\$ ]]; then
    log "kill port=$HEALTH_PORT pid=\$p"
    kill -9 "\$p" 2>/dev/null || true
    sleep 1
  fi
}
daemon_loop() {
  log "daemon start interval=${CHECK_INTERVAL}s grace=${STARTUP_GRACE}s"
  local since_start=0
  while true; do
    sleep "$CHECK_INTERVAL"
    local pid
    pid=\$(pid_on_port || true)
    if [[ -z "\$pid" ]]; then
      log "no pid on port $HEALTH_PORT - restart"
      start_vite || log "start_vite FAILED"
      since_start=0
      continue
    fi
    local stat
    stat=\$(stat_of "\$pid")
    if is_dead_stat "\$stat"; then
      log "DEAD pid=\$pid stat=\$stat - kill+restart"
      kill -9 "\$pid" 2>/dev/null || true
      sleep 1
      kill_port
      start_vite || log "start_vite FAILED after dead"
      since_start=0
      continue
    fi
    since_start=\$((since_start + CHECK_INTERVAL))
    if (( since_start >= $STARTUP_GRACE )); then
      local probe
      probe=\$(check_health)
      case "\$probe" in
        OK*)
          log "healthy pid=\$pid stat=\$stat"
          ;;
        *)
          log "UNHEALTHY pid=\$pid stat=\$stat probe=\$probe - restart"
          kill -9 "\$pid" 2>/dev/null || true
          sleep 1
          kill_port
          start_vite || log "start_vite FAILED after unhealthy"
          since_start=0
          ;;
      esac
    fi
  done
}
daemon_loop
BODYEOF
}

start_daemon() {
  write_daemon_body
  nohup bash "$DAEMON_BODY_FILE" >/dev/null 2>&1 &
  disown
  echo $! > "$KEEPALIVE_PID_FILE"
  log "daemon spawned pid=$!"
}

# ============ 命令分发 ========================================================
cmd="${1:-status}"

case "$cmd" in
  start)
    if pid_on_port >/dev/null 2>&1; then
      local_stat=$(stat_of "$(pid_on_port)")
      if is_dead_stat "$local_stat"; then
        kill_port
        start_vite || log "start_vite FAILED on first try"
      else
        log "start: vite already running pid=$(pid_on_port) stat=$local_stat"
      fi
    else
      start_vite || log "start_vite FAILED on first try"
    fi
    if [[ -f "$KEEPALIVE_PID_FILE" ]] && kill -0 "$(cat "$KEEPALIVE_PID_FILE" 2>/dev/null)" 2>/dev/null; then
      log "daemon already running pid=$(cat "$KEEPALIVE_PID_FILE")"
    else
      start_daemon
    fi
    emit_status start
    ;;

  status)
    emit_status status
    ;;

  restart)
    log "restart requested"
    if [[ -f "$KEEPALIVE_PID_FILE" ]]; then
      dpid=$(cat "$KEEPALIVE_PID_FILE" 2>/dev/null || true)
      if [[ -n "$dpid" ]] && kill -0 "$dpid" 2>/dev/null; then
        kill -9 "$dpid" 2>/dev/null || true
        log "daemon killed pid=$dpid"
      fi
      rm -f "$KEEPALIVE_PID_FILE"
    fi
    kill_port
    start_vite || log "start_vite FAILED on restart"
    start_daemon
    emit_status restart
    ;;

  stop)
    if [[ -f "$KEEPALIVE_PID_FILE" ]]; then
      dpid=$(cat "$KEEPALIVE_PID_FILE" 2>/dev/null || true)
      if [[ -n "$dpid" ]] && kill -0 "$dpid" 2>/dev/null; then
        kill -9 "$dpid" 2>/dev/null || true
        log "daemon stopped pid=$dpid"
      fi
      rm -f "$KEEPALIVE_PID_FILE"
    else
      log "stop: no pid file"
    fi
    emit_status stop
    ;;

  *)
    echo "usage: $0 {start|status|restart|stop}" >&2
    exit 2
    ;;
esac
