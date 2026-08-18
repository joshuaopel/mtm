# SPDX-License-Identifier: MIT
"""
Derived handling numbers.

The vehicle format stores the raw physics inputs the simulation consumes —
spring stiffness, damping, engine force. None of them tell you how the truck
will actually feel. These turn them into the quantities that do, so the
Blender panel can show the same figures as the in-game tuning overlay.

This mirrors `src/game/handling.ts`. If you change a formula here, change it
there.

Reading cannon's suspension: its force is

    (stiffness * compression - damping * closingSpeed) * chassisMass

so `stiffness` is a spring rate per unit mass and `damping` a damping
coefficient per unit mass. Both scale with the truck, which is why a heavier
truck needs a proportionally higher stiffness to sit at the same height.
"""

import math

# 2g. The world runs at double gravity so trucks land instead of floating.
GRAVITY = 19.6


def handling_numbers(settings):
    """Derived figures for a `MTMVehicleProps` block."""
    stiffness = max(1e-3, settings.suspension_stiffness)
    mass = settings.mass

    # Equilibrium: 4 * stiffness * compression * mass = mass * g, so the mass
    # cancels and the resting squat depends only on stiffness.
    rest_compression = min(settings.suspension_travel, GRAVITY / (4 * stiffness))
    ride_height = (
        settings.wheel_radius
        + (settings.suspension_rest - rest_compression)
        - settings.axle_height
    )

    spring_rate = stiffness * mass
    corner_mass = mass / 4
    omega = math.sqrt(spring_rate / corner_mass)
    ride_frequency = omega / (2 * math.pi)

    critical = 2 * math.sqrt(spring_rate * corner_mass)
    rebound = (settings.suspension_damping * mass) / critical
    compression = (settings.suspension_compression * mass) / critical

    drive_force = settings.engine_force * 4
    weight = mass * GRAVITY
    rear_axle = abs(settings.rear_z)
    front_lift = (weight * rear_axle) / max(0.01, ride_height)

    return {
        "rest_compression": rest_compression,
        "ride_height": ride_height,
        "ride_frequency": ride_frequency,
        "rebound_damping": rebound,
        "compression_damping": compression,
        "drive_force": drive_force,
        "front_lift_threshold": front_lift,
        "wheelie_margin": drive_force / front_lift,
        "launch_acceleration": drive_force / mass,
        "bump_headroom": settings.suspension_travel - rest_compression,
    }


def damping_verdict(ratio):
    """
    Plain-language verdict on a damping ratio.

    Calibrated against measured drop tests rather than textbook bands: a
    raycast vehicle loses far more energy to tyre friction and the solver
    than an ideal spring-mass system. From a 3.5m drop, 0.47 gives a single
    6cm hop, 0.27 a clear quarter-metre rebound, and 0.11 three bounces.
    """
    if ratio < 0.13:
        return "pogo"
    if ratio < 0.20:
        return "loose"
    if ratio < 0.35:
        return "bouncy"
    if ratio < 0.60:
        return "firm"
    if ratio < 1.0:
        return "planted"
    return "dead"


def wheelie_verdict(margin):
    """How close the truck runs to lifting its nose under power."""
    if margin < 0.4:
        return "planted"
    if margin < 0.7:
        return "lifts"
    if margin < 1.0:
        return "wheelies"
    return "loops over"
