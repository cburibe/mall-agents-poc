"""Custom resource (Provider framework): contraseña permanente para usuarios de prueba (solo dev).

La contraseña se lee de Secrets Manager dentro de la Lambda; nunca viaja en la plantilla,
en las propiedades del recurso ni en los logs. Idempotente: Create y Update aplican la misma
operación; Delete no hace nada (CloudFormation borra el usuario).
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

import boto3
from aws_lambda_powertools import Logger, Tracer
from aws_lambda_powertools.utilities.typing import LambdaContext

if TYPE_CHECKING:
    from mypy_boto3_cognito_idp import CognitoIdentityProviderClient
    from mypy_boto3_secretsmanager import SecretsManagerClient

logger = Logger()
tracer = Tracer()

# Clientes fuera del handler (BP-PY-07).
cognito: CognitoIdentityProviderClient = boto3.client("cognito-idp")
secrets: SecretsManagerClient = boto3.client("secretsmanager")


class InvalidRequestError(ValueError):
    """Propiedades del custom resource incompletas."""


def _required(props: dict[str, Any], key: str) -> str:
    value = props.get(key)
    if not isinstance(value, str) or not value:
        raise InvalidRequestError(f"Falta la propiedad {key}")
    return value


@tracer.capture_lambda_handler
@logger.inject_lambda_context(clear_state=True)
def handler(event: dict[str, Any], context: LambdaContext) -> dict[str, Any]:
    request_type = event["RequestType"]
    props: dict[str, Any] = event.get("ResourceProperties", {})
    user_pool_id = _required(props, "UserPoolId")
    username = _required(props, "Username")
    physical_id = f"{user_pool_id}/{username}"
    logger.append_keys(request_type=request_type, username=username)

    if request_type == "Delete":
        logger.info("Delete: sin acción; CloudFormation elimina el usuario")
        return {"PhysicalResourceId": event.get("PhysicalResourceId", physical_id)}

    secret_arn = _required(props, "SecretArn")
    password = secrets.get_secret_value(SecretId=secret_arn)["SecretString"]
    cognito.admin_set_user_password(
        UserPoolId=user_pool_id,
        Username=username,
        Password=password,
        Permanent=True,
    )
    logger.info("Contraseña permanente aplicada")
    return {"PhysicalResourceId": physical_id}
