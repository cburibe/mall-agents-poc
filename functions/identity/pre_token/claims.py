"""Lógica determinística de claims del access token (BP-GEN-01, ADR-004).

Reglas:
- Solo se emiten claims propios (`mall_id`, `roles`); nunca claims reservados.
- `roles` sale de los grupos que Cognito reporta en el evento (no de atributos del usuario)
  y se filtra contra la lista de roles conocidos.
- `mall_id` sale del atributo inmutable `custom:mall_id`, validado como entero positivo acotado.
- Un valor inválido no rompe el login: se omite el claim y se reporta una anomalía.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Final

KNOWN_ROLES: Final[frozenset[str]] = frozenset({"visitante", "gerente_mall", "analista", "admin"})
# Roles cuyo alcance es un solo mall: requieren mall_id.
MALL_SCOPED_ROLES: Final[frozenset[str]] = frozenset({"gerente_mall"})
MALL_ID_ATTRIBUTE: Final[str] = "custom:mall_id"
_MALL_ID_PATTERN: Final[re.Pattern[str]] = re.compile(r"[1-9][0-9]{0,5}")


@dataclass(frozen=True)
class ClaimsDecision:
    claims: dict[str, str | list[str]]
    anomalies: list[str] = field(default_factory=list)


def parse_mall_id(raw: str | None) -> str | None:
    """Devuelve el mall_id normalizado o None si no es un entero positivo de hasta 6 dígitos."""
    if raw is None:
        return None
    return raw if _MALL_ID_PATTERN.fullmatch(raw) else None


def build_access_token_claims(user_attributes: dict[str, str], groups: list[str]) -> ClaimsDecision:
    anomalies: list[str] = []

    roles = sorted({g for g in groups if g in KNOWN_ROLES})
    unknown = sorted(set(groups) - KNOWN_ROLES)
    if unknown:
        anomalies.append("grupos_desconocidos_ignorados")

    claims: dict[str, str | list[str]] = {"roles": roles}

    raw_mall_id = user_attributes.get(MALL_ID_ATTRIBUTE)
    mall_id = parse_mall_id(raw_mall_id)
    if raw_mall_id is not None and mall_id is None:
        anomalies.append("mall_id_invalido")
    if mall_id is not None:
        claims["mall_id"] = mall_id
    elif MALL_SCOPED_ROLES.intersection(roles):
        anomalies.append("rol_de_mall_sin_mall_id")

    return ClaimsDecision(claims=claims, anomalies=anomalies)
