"""Cognito Pre Token Generation (evento V2): agrega mall_id y roles al access token."""

from __future__ import annotations

from typing import Any

from aws_lambda_powertools import Logger, Metrics, Tracer
from aws_lambda_powertools.metrics import MetricUnit
from aws_lambda_powertools.utilities.typing import LambdaContext
from claims import build_access_token_claims
from pydantic import BaseModel, ConfigDict, Field, ValidationError

logger = Logger()
tracer = Tracer()
metrics = Metrics()


class GroupConfiguration(BaseModel):
    model_config = ConfigDict(extra="ignore")
    groups_to_override: list[str] = Field(default_factory=list, alias="groupsToOverride")


class PreTokenRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    user_attributes: dict[str, str] = Field(default_factory=dict, alias="userAttributes")
    group_configuration: GroupConfiguration = Field(default_factory=GroupConfiguration, alias="groupConfiguration")


class PreTokenEvent(BaseModel):
    model_config = ConfigDict(extra="ignore")
    version: str
    trigger_source: str = Field(alias="triggerSource")
    request: PreTokenRequest


@metrics.log_metrics
@tracer.capture_lambda_handler
@logger.inject_lambda_context(clear_state=True)
def handler(event: dict[str, Any], context: LambdaContext) -> dict[str, Any]:
    try:
        parsed = PreTokenEvent.model_validate(event)
    except ValidationError:
        # No se rompe el login por un evento inesperado; se registra sin datos del usuario.
        logger.warning("Evento de Pre Token Generation con forma inesperada")
        metrics.add_metric(name="pre_token_anomalia", unit=MetricUnit.Count, value=1)
        return event

    if parsed.version != "2":
        # Solo V2 permite personalizar el access token; con V1 no se emite nada.
        logger.warning("Versión de evento no soportada", extra={"version": parsed.version})
        metrics.add_metric(name="pre_token_anomalia", unit=MetricUnit.Count, value=1)
        return event

    decision = build_access_token_claims(
        user_attributes=parsed.request.user_attributes,
        groups=parsed.request.group_configuration.groups_to_override,
    )
    for anomaly in decision.anomalies:
        logger.warning("Anomalía de identidad", extra={"anomalia": anomaly})
        metrics.add_metric(name="pre_token_anomalia", unit=MetricUnit.Count, value=1)

    logger.info(
        "Claims emitidos",
        extra={"trigger": parsed.trigger_source, "claims": sorted(decision.claims)},
    )
    event.setdefault("response", {})
    event["response"]["claimsAndScopeOverrideDetails"] = {
        "accessTokenGeneration": {"claimsToAddOrOverride": decision.claims},
    }
    return event
