from __future__ import annotations

import copy
import json
from dataclasses import dataclass
from typing import Any

import handler as pre_token
import pytest
from claims import build_access_token_claims, parse_mall_id

RESERVED_CLAIMS = {"sub", "iss", "aud", "exp", "iat", "token_use", "client_id", "scope", "cognito:groups", "username"}


@dataclass
class FakeContext:
    function_name: str = "pre-token"
    memory_limit_in_mb: int = 256
    invoked_function_arn: str = "arn:aws:lambda:us-east-2:123456789012:function:pre-token"
    aws_request_id: str = "req-1"


def make_event(
    attributes: dict[str, str] | None = None,
    groups: list[str] | None = None,
    version: str = "2",
) -> dict[str, Any]:
    return {
        "version": version,
        "triggerSource": "TokenGeneration_Authentication",
        "region": "us-east-2",
        "userPoolId": "us-east-2_test",
        "userName": "usuario",
        "callerContext": {"awsSdkVersion": "x", "clientId": "web"},
        "request": {
            "userAttributes": attributes or {"sub": "abc"},
            "groupConfiguration": {
                "groupsToOverride": groups or [],
                "iamRolesToOverride": [],
                "preferredRole": None,
            },
            "scopes": ["aws.cognito.signin.user.admin"],
        },
        "response": {"claimsAndScopeOverrideDetails": None},
    }


def access_claims(result: dict[str, Any]) -> dict[str, Any]:
    details = result["response"]["claimsAndScopeOverrideDetails"]
    claims: dict[str, Any] = details["accessTokenGeneration"]["claimsToAddOrOverride"]
    return claims


def invoke(event: dict[str, Any]) -> dict[str, Any]:
    result: dict[str, Any] = pre_token.handler(event, FakeContext())
    return result


# --- Camino feliz por rol ---------------------------------------------------------------


def test_gerente_recibe_mall_id_y_rol() -> None:
    result = invoke(make_event({"sub": "u1", "custom:mall_id": "1"}, ["gerente_mall"]))
    assert access_claims(result) == {"roles": ["gerente_mall"], "mall_id": "1"}


def test_visitante_sin_mall_id() -> None:
    result = invoke(make_event({"sub": "u2"}, ["visitante"]))
    assert access_claims(result) == {"roles": ["visitante"]}


def test_analista_sin_mall_id_no_es_anomalia() -> None:
    decision = build_access_token_claims({"sub": "u3"}, ["analista"])
    assert decision.claims == {"roles": ["analista"]}
    assert decision.anomalies == []


def test_varios_grupos_ordenados_y_sin_duplicados() -> None:
    decision = build_access_token_claims({}, ["admin", "analista", "admin"])
    assert decision.claims["roles"] == ["admin", "analista"]


# --- Casos adversariales -----------------------------------------------------------------


@pytest.mark.parametrize(
    "raw",
    # "\uff11" es un dígito Unicode de ancho completo: no debe aceptarse como "1".
    ["abc", "-1", "0", "01", "1 OR 1=1", "1,2", "1;DROP", "1234567", " 1", "1\n", "\uff11", "", "1.0", "0x1"],
)
def test_mall_id_invalido_no_se_emite(raw: str) -> None:
    decision = build_access_token_claims({"custom:mall_id": raw}, ["gerente_mall"])
    assert "mall_id" not in decision.claims
    assert "mall_id_invalido" in decision.anomalies
    assert "rol_de_mall_sin_mall_id" in decision.anomalies


@pytest.mark.parametrize("raw,expected", [("1", "1"), ("42", "42"), ("999999", "999999"), (None, None)])
def test_parse_mall_id(raw: str | None, expected: str | None) -> None:
    assert parse_mall_id(raw) == expected


def test_gerente_sin_mall_id_es_anomalia_pero_no_rompe_login() -> None:
    result = invoke(make_event({"sub": "u4"}, ["gerente_mall"]))
    assert access_claims(result) == {"roles": ["gerente_mall"]}


def test_grupos_desconocidos_se_ignoran() -> None:
    decision = build_access_token_claims({}, ["visitante", "superadmin", "admin "])
    assert decision.claims["roles"] == ["visitante"]
    assert "grupos_desconocidos_ignorados" in decision.anomalies


def test_roles_no_salen_de_atributos_del_usuario() -> None:
    """Un atributo que imita grupos o roles no otorga privilegios: solo cuentan los grupos de Cognito."""
    attributes = {
        "custom:mall_id": "1",
        "cognito:groups": "admin",
        "custom:roles": "admin",
        "custom:mall_id ": "2",
    }
    decision = build_access_token_claims(attributes, ["visitante"])
    assert decision.claims == {"roles": ["visitante"], "mall_id": "1"}


def test_nunca_emite_claims_reservados() -> None:
    attributes = {"custom:mall_id": "3", "sub": "x", "iss": "evil", "token_use": "id", "client_id": "otro"}
    result = invoke(make_event(attributes, ["gerente_mall", "admin"]))
    claims = access_claims(result)
    assert set(claims) <= {"roles", "mall_id"}
    assert not RESERVED_CLAIMS.intersection(claims)


def test_evento_v1_no_modifica_tokens() -> None:
    event = make_event({"custom:mall_id": "1"}, ["gerente_mall"], version="1")
    original = copy.deepcopy(event)
    assert invoke(event) == original


def test_evento_malformado_no_rompe_login() -> None:
    event: dict[str, Any] = {"version": "2", "request": "no-es-un-objeto"}
    assert invoke(event) == {"version": "2", "request": "no-es-un-objeto"}


def test_no_registra_mall_id_ni_atributos(capsys: pytest.CaptureFixture[str]) -> None:
    invoke(make_event({"sub": "secreto-sub", "custom:mall_id": "77"}, ["gerente_mall"]))
    logs = capsys.readouterr().out
    assert "secreto-sub" not in logs
    assert '"77"' not in logs
    for line in logs.strip().splitlines():
        json.loads(line)  # logs estructurados en JSON (BP-PY-06)
