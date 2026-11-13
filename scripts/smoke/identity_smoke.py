"""Smoke de identidad contra un ambiente desplegado (post-step del pipeline, BP-PIPE-04).

Verifica de punta a punta:
1. Login SRP de cada usuario de prueba con el cliente `web`.
2. El ACCESS token trae `roles` y, solo para gerente_mall, `mall_id` (trigger Pre Token Generation V2).
3. El cliente M2M `orquestador-m2m` obtiene un token con client_credentials y los scopes del resource server.

Nunca imprime contraseñas, secretos ni tokens.
"""

from __future__ import annotations

import argparse
import base64
import json
import logging
import sys
from typing import Any

import boto3
import requests
from pycognito import Cognito

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger("smoke")

EXPECTED: dict[str, dict[str, Any]] = {
    "visitante.demo": {"roles": ["visitante"], "mall_id": None},
    "gerente.norte": {"roles": ["gerente_mall"], "mall_id": "1"},
    "analista.demo": {"roles": ["analista"], "mall_id": None},
}
EXPECTED_M2M_SCOPES = {"mall-tools/tools.read", "mall-tools/tools.write"}


def decode_claims(jwt: str) -> dict[str, Any]:
    payload = jwt.split(".")[1]
    payload += "=" * (-len(payload) % 4)
    claims: dict[str, Any] = json.loads(base64.urlsafe_b64decode(payload))
    return claims


def check_user(username: str, pool_id: str, client_id: str, sm: Any, prefix: str) -> list[str]:
    errors: list[str] = []
    secret_arn = ssm_get(f"{prefix}/test-users/{username}/secret-arn")
    password = sm.get_secret_value(SecretId=secret_arn)["SecretString"]
    user = Cognito(pool_id, client_id, username=username)
    user.authenticate(password=password)
    claims = decode_claims(user.access_token)
    expected = EXPECTED[username]

    if claims.get("token_use") != "access":
        errors.append(f"{username}: el token verificado no es un access token")
    if claims.get("roles") != expected["roles"]:
        errors.append(f"{username}: roles={claims.get('roles')} esperado={expected['roles']}")
    if claims.get("mall_id") != expected["mall_id"]:
        errors.append(f"{username}: mall_id={claims.get('mall_id')!r} esperado={expected['mall_id']!r}")
    if not errors:
        log.info("OK %s: roles=%s mall_id=%s", username, claims.get("roles"), claims.get("mall_id"))
    return errors


def check_m2m(pool_id: str, client_id: str, domain: str) -> list[str]:
    idp = boto3.client("cognito-idp")
    secret = idp.describe_user_pool_client(UserPoolId=pool_id, ClientId=client_id)["UserPoolClient"]["ClientSecret"]
    response = requests.post(
        f"{domain}/oauth2/token",
        data={"grant_type": "client_credentials", "scope": " ".join(sorted(EXPECTED_M2M_SCOPES))},
        auth=(client_id, secret),
        timeout=10,
    )
    if response.status_code != 200:
        return [f"m2m: token endpoint respondió HTTP {response.status_code}"]
    scopes = set(decode_claims(response.json()["access_token"]).get("scope", "").split())
    if scopes != EXPECTED_M2M_SCOPES:
        return [f"m2m: scopes={sorted(scopes)} esperado={sorted(EXPECTED_M2M_SCOPES)}"]
    log.info("OK orquestador-m2m: scopes=%s", sorted(scopes))
    return []


_ssm = None


def ssm_get(name: str) -> str:
    global _ssm  # noqa: PLW0603
    if _ssm is None:
        _ssm = boto3.client("ssm")
    value: str = _ssm.get_parameter(Name=name)["Parameter"]["Value"]
    return value


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--env", default="dev", choices=["dev", "prod"])
    args = parser.parse_args()
    prefix = f"/mall-agents/{args.env}"

    pool_id = ssm_get(f"{prefix}/cognito/user-pool-id")
    web_client = ssm_get(f"{prefix}/cognito/web-client-id")
    m2m_client = ssm_get(f"{prefix}/cognito/orquestador-client-id")
    domain = ssm_get(f"{prefix}/cognito/domain")
    sm = boto3.client("secretsmanager")

    errors: list[str] = []
    for username in EXPECTED:
        errors += check_user(username, pool_id, web_client, sm, prefix)
    errors += check_m2m(pool_id, m2m_client, domain)

    for error in errors:
        log.error(error)
    log.info("Smoke de identidad: %s", "FALLÓ" if errors else "OK")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
