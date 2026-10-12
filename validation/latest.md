# Executed physics validation

Executed: 2026-10-12T09:30:36.167Z. 92/92 checks passed.

| Experiment | Domain | Expected | Measured | Absolute error | Relative error | Tolerance | Result | Assumptions |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 12 V / 6 Ω branch current | electrical | 2 | 2 | 0.000e+0 | 0.000e+0 | 1e-10 | PASS | Ideal source, 6 Ω constant resistance, ideal wires |
| 12 V × 2 A resistive power | electrical | 24 | 24 | 0.000e+0 | 0.000e+0 | 1e-9 | PASS | Independent Ohm-law reference |
| 24 W × 10 s energy | electrical | 240 | 240.00000000000233 | 2.331e-12 | 9.711e-15 | 1e-8 | PASS | Fixed-step rectangular integration; power constant |
| Net electrical power residual | electrical | 0 | 0 | 0.000e+0 | — | 1e-9 | PASS | Independent sum of ideal-source and branch powers |
| Disconnected load current | electrical | 0 | 0 | 0.000e+0 | — | 1e-10 | PASS | Open circuit, no leakage model |
| 10 L water heated 20→80°C (9.982071 kg) | thermal | 2503503.4068 | 2503505.708998064 | 2.302e+0 | 9.196e-7 | 33.33433333333333 | PASS | Step crossing bounded by one interval of ≤2 kW input; heater storage accounted separately |
| Isolated coupled heating conservation | coupling | 0 | -0.000020655803382396698 | 2.066e-5 | — | 0.001 | PASS | Backward Euler symmetric immersion transfer; tolerance 1 mJ over ~2.5 MJ |
| OFF removes new electrical energy | coupling | 2525689.691076456 | 2525689.691076456 | 0.000e+0 | 0.000e+0 | 1e-8 | PASS | Stored thermal energy remains, heater electrical branch failed open |
| Thermal inertia still warms water | coupling | 1 | 1 | 0.000e+0 | 0.000e+0 | 0 | PASS | Hot element retains sensible energy after power removal |
| Ambient cooling convergence dt=0.100000 s | thermal | 78.08161478024645 | 78.08161989115646 | 5.111e-6 | 6.546e-8 | 0.0000052950314135524786 | PASS | Analytic exponential cooling with conserved initial water mass; first-order BE error bound ΔT λ² t dt / 2 |
| Cooling conservation dt=0.100000 s | thermal | 0 | 5.55693986825645e-7 | 5.557e-7 | — | 0.001 | PASS | Signed external heat and stored thermal change; no power source |
| Ambient cooling convergence dt=0.050000 s | thermal | 78.08161478024645 | 78.08161733576587 | 2.556e-6 | 3.273e-8 | 0.0000026525157067762392 | PASS | Analytic exponential cooling with conserved initial water mass; first-order BE error bound ΔT λ² t dt / 2 |
| Cooling conservation dt=0.050000 s | thermal | 0 | -0.000002192638930864632 | 2.193e-6 | — | 0.001 | PASS | Signed external heat and stored thermal change; no power source |
| Ambient cooling convergence dt=0.025000 s | thermal | 78.08161478024645 | 78.08161605803498 | 1.278e-6 | 1.636e-8 | 0.0000013312578533881196 | PASS | Analytic exponential cooling with conserved initial water mass; first-order BE error bound ΔT λ² t dt / 2 |
| Cooling conservation dt=0.025000 s | thermal | 0 | -0.0000022391031961888075 | 2.239e-6 | — | 0.001 | PASS | Signed external heat and stored thermal change; no power source |
| Ambient cooling convergence dt=0.016667 s | thermal | 78.08161478024645 | 78.0816156318544 | 8.516e-7 | 1.091e-8 | 8.90838568925413e-7 | PASS | Analytic exponential cooling with conserved initial water mass; first-order BE error bound ΔT λ² t dt / 2 |
| Cooling conservation dt=0.016667 s | thermal | 0 | 0.000008883638656698167 | 8.884e-6 | — | 0.001 | PASS | Signed external heat and stored thermal change; no power source |
| Halving timestep approximately halves error | numerical | 2 | 1.9999495909140017 | 5.041e-5 | 2.520e-5 | 0.001 | PASS | Backward Euler first-order convergence for smooth single-mass cooling |
| Closed relay and safety current | electrical | 8.324661810613943 | 8.324661810613941 | 1.776e-15 | 2.134e-16 | 1e-9 | PASS | Finite series contact resistances 0.02 Ω and 0.01 Ω |
| Closed-loop regulation inside plausible bounds | automation | 1 | 1 | 0.000e+0 | 0.000e+0 | 0 | PASS | 78/80°C hysteresis; finite element inertia and 8 W/K cooling |
| Long run energy conservation | coupling | 0 | 0.000028385315090417862 | 2.839e-5 | — | 0.001 | PASS | All contact/element heat storage and ambient/coolant exchange included |
| Failed sensor opens controlled heater | automation | 0 | 0 | 0.000e+0 | — | 1e-8 | PASS | Invalid control propagates; NO relay defaults open |
| Independent safety interrupts welded normal contact | safety | 0 | 0 | 0.000e+0 | — | 1e-8 | PASS | Separate safety sensing path, fail-on-invalid enabled |
| Safety remains latched | safety | 1 | 1 | 0.000e+0 | 0.000e+0 | 0 | PASS | Manual reset required; no automatic reset |
| Live mass edit rejected by engine | integrity | 0 | 0 | 0.000e+0 | — | 0 | PASS | No implicit mass or energy injection; Reset required |
| Undersized relay reported outside its rating | protection | 1 | 1 | 0.000e+0 | 0.000e+0 | 0 | PASS | 8.32 A through a paid 5 A model: rating violation reported (scored run fails); no contact-wear model, so no fabricated failure |
| Overloaded contact keeps conducting actual current | electrical | 8.324661810613943 | 8.324661810615908 | 1.965e-12 | 2.360e-13 | 1e-9 | PASS | Failure only through the modelled contact temperature |
| Reset restores initial healthy topology | protection | 1 | 1 | 0.000e+0 | 0.000e+0 | 0 | PASS | Permanent failure replaced only by full experiment Reset |
| Half voltage gives quarter heater power | coupling | 0.25 | 0.25 | 0.000e+0 | 0.000e+0 | 1e-10 | PASS | Same fixed resistor and series contact resistances, Ohm law |
| Complete fault-and-recovery challenge | challenge | 1 | 1 | 0.000e+0 | 0.000e+0 | 0 | PASS | Actual 240 s regulation, coolant reduction/loss, welded relay, independent trip, cool manual reset, 120 s recovery; no temperature script |
| Challenge stays below critical water temperature | safety | 1 | 1 | 0.000e+0 | 0.000e+0 | 0 | PASS | Independent cutoff threshold 90°C; thermal inertia retained |
| Locked environment exploit rejected | integrity | 1 | 1 | 0.000e+0 | 0.000e+0 | 0 | PASS | Challenge initial/environment conditions validated before solver state initializes |
| RC charge: capacitor voltage after 1 s (τ ≈ 1 s) | electrical | 7.5852228129036465 | 7.585222812903642 | 4.441e-15 | 5.855e-16 | 1e-9 | PASS | 12 V through 1 kΩ into 1 mF (ESR 50 mΩ, 1 GΩ leakage); exact modal step of the linear network at h = 1/60 s |
| RC charge: loop loss Q·V − ½·C·V² (→ ½·C·V² at full charge) | electrical | 0.07199999984483896 | 0.07200129585022805 | 1.296e-6 | 1.800e-5 | 0.000002 | PASS | After 10 τ the supply has delivered Q = C·V at 12 V; tolerance covers the 1 GΩ leakage loss over 10 s (1.3 µJ) |
| Direct switch-on of 100 µF (τ = 6 µs ≪ h): voltage after one step | electrical | 11.99999999988 | 11.999999999880002 | 1.776e-15 | 1.480e-16 | 1e-9 | PASS | Transient shorter than the step settles exactly within it, without ringing; inrush peak not resolved |
| Charge sharing between equal capacitors: field energy lost | electrical | -0.025 | -0.02500000499999955 | 5.000e-9 | 2.000e-7 | 0.000001 | PASS | 10 V and 0 V, 1 mF each, through 1 Ω: both settle at 5 V, half the field energy is dissipated |
| Battery polarization voltage after τ₁ at 2 A | electrical | 0.018963616764856576 | 0.01896361676485749 | 9.125e-16 | 4.812e-14 | 1e-12 | PASS | R₁ = 15 mΩ, τ₁ = 30 s; exact exponential of the R₁ ∥ C₁ branch at constant current |
| Coupled mass balance at dt=0.016666666666666666 | multiphysics | 0 | -1.8417267710901797e-11 | 1.842e-11 | — | 1e-7 | PASS | Finite tanks; nonlinear continuity tolerance 1e-12 m³/s; no post-integration volume clamp |
| Coupled energy balance at dt=0.016666666666666666 | multiphysics | 0 | -0.0000048957307967612 | 4.896e-6 | — | 0.1 | PASS | Electrical supply = thermal + rotor + hydrostatic storage + ambient + shaft export; explicit storage-head splitting |
| Coupled mass balance at dt=0.008333333333333333 | multiphysics | 0 | -9.180212146020494e-12 | 9.180e-12 | — | 1e-7 | PASS | Finite tanks; nonlinear continuity tolerance 1e-12 m³/s; no post-integration volume clamp |
| Coupled energy balance at dt=0.008333333333333333 | multiphysics | 0 | -0.0000010974832207466534 | 1.097e-6 | — | 0.1 | PASS | Electrical supply = thermal + rotor + hydrostatic storage + ambient + shaft export; explicit storage-head splitting |
| Coupled mass balance at dt=0.004166666666666667 | multiphysics | 0 | -4.376943252282217e-12 | 4.377e-12 | — | 1e-7 | PASS | Finite tanks; nonlinear continuity tolerance 1e-12 m³/s; no post-integration volume clamp |
| Coupled energy balance at dt=0.004166666666666667 | multiphysics | 0 | -6.6310769852862e-7 | 6.631e-7 | — | 0.1 | PASS | Electrical supply = thermal + rotor + hydrostatic storage + ambient + shaft export; explicit storage-head splitting |
| Coupled mass balance at dt=0.0020833333333333333 | multiphysics | 0 | -1.5916157281026244e-12 | 1.592e-12 | — | 1e-7 | PASS | Finite tanks; nonlinear continuity tolerance 1e-12 m³/s; no post-integration volume clamp |
| Coupled energy balance at dt=0.0020833333333333333 | multiphysics | 0 | 3.5066136661043856e-7 | 3.507e-7 | — | 0.1 | PASS | Electrical supply = thermal + rotor + hydrostatic storage + ambient + shaft export; explicit storage-head splitting |
| Coupled mass balance at dt=0.0010416666666666667 | multiphysics | 0 | -4.831690603168681e-13 | 4.832e-13 | — | 1e-7 | PASS | Finite tanks; nonlinear continuity tolerance 1e-12 m³/s; no post-integration volume clamp |
| Coupled energy balance at dt=0.0010416666666666667 | multiphysics | 0 | 0.0000050938646438680735 | 5.094e-6 | — | 0.1 | PASS | Electrical supply = thermal + rotor + hydrostatic storage + ambient + shaft export; explicit storage-head splitting |
| Destination-volume convergence dt=0.016666666666666666 | multiphysics | 0.0009515240855428227 | 0.0009514926491032305 | 3.144e-8 | 3.304e-5 | 0.000002 | PASS | 2 s startup against dt=1/960 s reference; tolerance 2 mL |
| Motor-current convergence dt=0.016666666666666666 | multiphysics | 5.025546759772543 | 5.042078513569057 | 1.653e-2 | 3.290e-3 | 0.03 | PASS | 2 s startup; midpoint electrical/mechanical coupling; current tolerance 30 mA |
| Motor-speed convergence dt=0.016666666666666666 | multiphysics | 224.63329963380698 | 224.63511564883873 | 1.816e-3 | 8.084e-6 | 0.01 | PASS | 2 s startup; speed tolerance 0.01 rad/s |
| Fluid-temperature convergence dt=0.016666666666666666 | multiphysics | 293.15125399121945 | 293.1512579723403 | 3.981e-6 | 1.358e-8 | 0.001 | PASS | Conservative zero-volume enthalpy transport plus backward-Euler tank loss; tolerance 1 mK |
| Destination-volume convergence dt=0.008333333333333333 | multiphysics | 0.0009515240855428227 | 0.0009514641166492222 | 5.997e-8 | 6.302e-5 | 0.000002 | PASS | 2 s startup against dt=1/960 s reference; tolerance 2 mL |
| Motor-current convergence dt=0.008333333333333333 | multiphysics | 5.025546759772543 | 5.033238955614481 | 7.692e-3 | 1.531e-3 | 0.03 | PASS | 2 s startup; midpoint electrical/mechanical coupling; current tolerance 30 mA |
| Motor-speed convergence dt=0.008333333333333333 | multiphysics | 224.63329963380698 | 224.63395365272152 | 6.540e-4 | 2.911e-6 | 0.01 | PASS | 2 s startup; speed tolerance 0.01 rad/s |
| Fluid-temperature convergence dt=0.008333333333333333 | multiphysics | 293.15125399121945 | 293.1512559114342 | 1.920e-6 | 6.550e-9 | 0.001 | PASS | Conservative zero-volume enthalpy transport plus backward-Euler tank loss; tolerance 1 mK |
| Destination-volume convergence dt=0.004166666666666667 | multiphysics | 0.0009515240855428227 | 0.0009515364548792159 | 1.237e-8 | 1.300e-5 | 0.000002 | PASS | 2 s startup against dt=1/960 s reference; tolerance 2 mL |
| Motor-current convergence dt=0.004166666666666667 | multiphysics | 5.025546759772543 | 5.028851556632009 | 3.305e-3 | 6.576e-4 | 0.03 | PASS | 2 s startup; midpoint electrical/mechanical coupling; current tolerance 30 mA |
| Motor-speed convergence dt=0.004166666666666667 | multiphysics | 224.63329963380698 | 224.63334456624662 | 4.493e-5 | 2.000e-7 | 0.01 | PASS | 2 s startup; speed tolerance 0.01 rad/s |
| Fluid-temperature convergence dt=0.004166666666666667 | multiphysics | 293.15125399121945 | 293.1512547641677 | 7.729e-7 | 2.637e-9 | 0.001 | PASS | Conservative zero-volume enthalpy transport plus backward-Euler tank loss; tolerance 1 mK |
| Destination-volume convergence dt=0.0020833333333333333 | multiphysics | 0.0009515240855428227 | 0.0009515257145547882 | 1.629e-9 | 1.712e-6 | 0.000002 | PASS | 2 s startup against dt=1/960 s reference; tolerance 2 mL |
| Motor-current convergence dt=0.0020833333333333333 | multiphysics | 5.025546759772543 | 5.02664732043173 | 1.101e-3 | 2.190e-4 | 0.03 | PASS | 2 s startup; midpoint electrical/mechanical coupling; current tolerance 30 mA |
| Motor-speed convergence dt=0.0020833333333333333 | multiphysics | 224.63329963380698 | 224.6333111988999 | 1.157e-5 | 5.148e-8 | 0.01 | PASS | 2 s startup; speed tolerance 0.01 rad/s |
| Fluid-temperature convergence dt=0.0020833333333333333 | multiphysics | 293.15125399121945 | 293.15125425411344 | 2.629e-7 | 8.968e-10 | 0.001 | PASS | Conservative zero-volume enthalpy transport plus backward-Euler tank loss; tolerance 1 mK |
| Halved internal timestep reduces volume error by at least two | multiphysics | 1 | 1 | 0.000e+0 | 0.000e+0 | 0 | PASS | dt=1/240 and 1/480 against dt=1/960; errors 1.2369336393146767e-8 and 1.6290119654680663e-9 m³, ratio 7.593152570609061; numerical floor 1e-12 m³. Pump/check-valve startup need not follow a single power-law error ratio. |
| Pump shaft input bounds hydraulic output | multiphysics | 1 | 1 | 0.000e+0 | 0.000e+0 | 0 | PASS | Affinity head curve; hydraulic efficiency ≤1; explicit mechanical drag |
| Free-fall velocity dt=0.016666666666666666 | mechanical | -9.80665 | -9.806649999999944 | 5.507e-14 | 5.615e-15 | 1e-8 | PASS | Gravity only; no air drag, no impact; exact constant acceleration velocity |
| Free-fall position dt=0.016666666666666666 | mechanical | 5.096675 | 5.086459739583345 | 1.022e-2 | 2.004e-3 | 0.011 | PASS | Planck semi-implicit Euler; internal h≤1/480 s; position error O(h) |
| Free-fall velocity dt=0.004166666666666667 | mechanical | -9.80665 | -9.806649999999944 | 5.507e-14 | 5.615e-15 | 1e-8 | PASS | Gravity only; no air drag, no impact; exact constant acceleration velocity |
| Free-fall position dt=0.004166666666666667 | mechanical | 5.096675 | 5.086459739583345 | 1.022e-2 | 2.004e-3 | 0.011 | PASS | Planck semi-implicit Euler; internal h≤1/480 s; position error O(h) |
| Free-fall velocity dt=0.0020833333333333333 | mechanical | -9.80665 | -9.806649999999944 | 5.507e-14 | 5.615e-15 | 1e-8 | PASS | Gravity only; no air drag, no impact; exact constant acceleration velocity |
| Free-fall position dt=0.0020833333333333333 | mechanical | 5.096675 | 5.086459739583345 | 1.022e-2 | 2.004e-3 | 0.011 | PASS | Planck semi-implicit Euler; internal h≤1/480 s; position error O(h) |
| Free-fall velocity dt=0.0010416666666666667 | mechanical | -9.80665 | -9.80664999999991 | 8.882e-14 | 9.057e-15 | 1e-8 | PASS | Gravity only; no air drag, no impact; exact constant acceleration velocity |
| Free-fall position dt=0.0010416666666666667 | mechanical | 5.096675 | 5.091567369791699 | 5.108e-3 | 1.002e-3 | 0.011 | PASS | Planck semi-implicit Euler; internal h≤1/480 s; position error O(h) |
| Free-fall halving internal timestep error ratio | mechanical | 2 | 2.00000000001026 | 1.026e-11 | 5.130e-12 | 1e-7 | PASS | h=1/480 versus 1/960 s; analytical reference; O(h) position integration |
| Rigid disk inertia | mechanical | 0.04000000000000001 | 0.04000000000000001 | 0.000e+0 | 0.000e+0 | 1e-10 | PASS | Solid disk with explicit 2 kg mass; radius 0.2 m |
| Constant torque angular acceleration | mechanical | 12.499999999999998 | 12.499999999999934 | 6.395e-14 | 5.116e-15 | 1e-8 | PASS | No other torques; omega=tau t/I |
| Constant torque work balance | mechanical | 0 | 3.197442310920451e-14 | 3.197e-14 | — | 1e-8 | PASS | Integrated torque times midpoint angular velocity equals kinetic-energy change |
| Electrical-spatial shaft energy balance dt=0.016666666666666666 | mechanical | 0 | -7.983125271948666e-11 | 7.983e-11 | — | 0.001 | PASS | Implicit motor midpoint coupled to Planck mass matrix; copper/friction/brake losses explicit |
| Authoritative motor/body shaft speed dt=0.016666666666666666 | mechanical | 0 | 0 | 0.000e+0 | — | 0 | PASS | One angular velocity; rotor inertia added to rigid-body inertia exactly once |
| Electrical-spatial speed convergence dt=0.016666666666666666 | mechanical | 64.26298311651148 | 64.26387263936584 | 8.895e-4 | 1.384e-5 | 0.005 | PASS | 2 s against dt=1/960 s reference; fixed duty and viscous shaft brake |
| Electrical-spatial current convergence dt=0.016666666666666666 | mechanical | 31.96891350689892 | 31.970589039686317 | 1.676e-3 | 5.241e-5 | 0.01 | PASS | MNA back EMF; latest midpoint current has O(h) reporting offset; tolerance 10 mA |
| Electrical-spatial shaft energy balance dt=0.004166666666666667 | mechanical | 0 | -3.771027934362792e-11 | 3.771e-11 | — | 0.001 | PASS | Implicit motor midpoint coupled to Planck mass matrix; copper/friction/brake losses explicit |
| Authoritative motor/body shaft speed dt=0.004166666666666667 | mechanical | 0 | 0 | 0.000e+0 | — | 0 | PASS | One angular velocity; rotor inertia added to rigid-body inertia exactly once |
| Electrical-spatial speed convergence dt=0.004166666666666667 | mechanical | 64.26298311651148 | 64.26387263936584 | 8.895e-4 | 1.384e-5 | 0.005 | PASS | 2 s against dt=1/960 s reference; fixed duty and viscous shaft brake |
| Electrical-spatial current convergence dt=0.004166666666666667 | mechanical | 31.96891350689892 | 31.970589039686317 | 1.676e-3 | 5.241e-5 | 0.01 | PASS | MNA back EMF; latest midpoint current has O(h) reporting offset; tolerance 10 mA |
| Electrical-spatial shaft energy balance dt=0.0020833333333333333 | mechanical | 0 | -1.9135804052439198e-10 | 1.914e-10 | — | 0.001 | PASS | Implicit motor midpoint coupled to Planck mass matrix; copper/friction/brake losses explicit |
| Authoritative motor/body shaft speed dt=0.0020833333333333333 | mechanical | 0 | 0 | 0.000e+0 | — | 0 | PASS | One angular velocity; rotor inertia added to rigid-body inertia exactly once |
| Electrical-spatial speed convergence dt=0.0020833333333333333 | mechanical | 64.26298311651148 | 64.26387263936584 | 8.895e-4 | 1.384e-5 | 0.005 | PASS | 2 s against dt=1/960 s reference; fixed duty and viscous shaft brake |
| Electrical-spatial current convergence dt=0.0020833333333333333 | mechanical | 31.96891350689892 | 31.970589039686317 | 1.676e-3 | 5.241e-5 | 0.01 | PASS | MNA back EMF; latest midpoint current has O(h) reporting offset; tolerance 10 mA |
| Electrical-spatial shaft energy balance dt=0.0010416666666666667 | mechanical | 0 | -2.1326940213839407e-11 | 2.133e-11 | — | 0.001 | PASS | Implicit motor midpoint coupled to Planck mass matrix; copper/friction/brake losses explicit |
| Authoritative motor/body shaft speed dt=0.0010416666666666667 | mechanical | 0 | 0 | 0.000e+0 | — | 0 | PASS | One angular velocity; rotor inertia added to rigid-body inertia exactly once |
| Finer shaft step reduces speed error | mechanical | 1 | 1 | 0.000e+0 | 0.000e+0 | 0 | PASS | h=1/480 against h=1/960 s reference; speed difference below 1 mrad/s |
