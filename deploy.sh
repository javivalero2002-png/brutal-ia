#!/bin/bash
# BRUTAL.IA — los deploys YA NO se hacen desde aquí.
#
# El proyecto de Vercel está conectado a javivalero2002-png/brutal-ia (rama main):
# cada push a main despliega a producción, con su SHA visible en el dashboard.
#
# Este script desplegaba el ÁRBOL DE TRABAJO, no un commit. Por eso producción
# llegó a servir bytes que no existían en ningún commit de git — comprobado:
# public/brutal-logo-ig.svg se servía en producción sin estar en ninguna rama ni
# commit. Se queda aquí a propósito, fallando, para que el reflejo de teclear
# `bash deploy.sh` no reintroduzca esa divergencia.
set -e
echo ""
echo "✖  deploy.sh está retirado."
echo ""
echo "   Para desplegar a producción:"
echo "       git add -A && git commit -m '...' && git push"
echo ""
echo "   Para volver atrás:"
echo "       vercel.com → brutalstudios-ia → Deployments → ⋯ → Promote to Production"
echo ""
exit 1
