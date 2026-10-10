# Executed physics validation

Executed: 2026-10-10T21:31:43.323Z. 87/87 checks passed.

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
| Overloaded contact keeps conducting actual current | electrical | 8.324661810613943 | 8.324661810614487 | 5.436e-13 | 6.530e-14 | 1e-9 | PASS | Failure only through the modelled contact temperature |
| Reset restores initial healthy topology | protection | 1 | 1 | 0.000e+0 | 0.000e+0 | 0 | PASS | Permanent failure replaced only by full experiment Reset |
| Half voltage gives quarter heater power | coupling | 0.25 | 0.25 | 0.000e+0 | 0.000e+0 | 1e-10 | PASS | Same fixed resistor and series contact resistances, Ohm law |
| Complete fault-and-recovery challenge | challenge | 1 | 1 | 0.000e+0 | 0.000e+0 | 0 | PASS | Actual 240 s regulation, coolant reduction/loss, welded relay, independent trip, cool manual reset, 120 s recovery; no temperature script |
| Challenge stays below critical water temperature | safety | 1 | 1 | 0.000e+0 | 0.000e+0 | 0 | PASS | Independent cutoff threshold 90°C; thermal inertia retained |
| Locked environment exploit rejected | integrity | 1 | 1 | 0.000e+0 | 0.000e+0 | 0 | PASS | Challenge initial/environment conditions validated before solver state initializes |
| Coupled mass balance at dt=0.016666666666666666 | multiphysics | 0 | -8.043343768804334e-12 | 8.043e-12 | — | 1e-7 | PASS | Finite tanks; nonlinear continuity tolerance 1e-12 m³/s; no post-integration volume clamp |
| Coupled energy balance at dt=0.016666666666666666 | multiphysics | 0 | -0.0002450826386848348 | 2.451e-4 | — | 0.1 | PASS | Electrical supply = thermal + rotor + hydrostatic storage + ambient + shaft export; explicit storage-head splitting |
| Coupled mass balance at dt=0.008333333333333333 | multiphysics | 0 | -6.59383658785373e-12 | 6.594e-12 | — | 1e-7 | PASS | Finite tanks; nonlinear continuity tolerance 1e-12 m³/s; no post-integration volume clamp |
| Coupled energy balance at dt=0.008333333333333333 | multiphysics | 0 | -0.0002451460597399091 | 2.451e-4 | — | 0.1 | PASS | Electrical supply = thermal + rotor + hydrostatic storage + ambient + shaft export; explicit storage-head splitting |
| Coupled mass balance at dt=0.004166666666666667 | multiphysics | 0 | -4.092726157978177e-12 | 4.093e-12 | — | 1e-7 | PASS | Finite tanks; nonlinear continuity tolerance 1e-12 m³/s; no post-integration volume clamp |
| Coupled energy balance at dt=0.004166666666666667 | multiphysics | 0 | -0.0002455476996772177 | 2.455e-4 | — | 0.1 | PASS | Electrical supply = thermal + rotor + hydrostatic storage + ambient + shaft export; explicit storage-head splitting |
| Coupled mass balance at dt=0.0020833333333333333 | multiphysics | 0 | -1.4495071809506044e-12 | 1.450e-12 | — | 1e-7 | PASS | Finite tanks; nonlinear continuity tolerance 1e-12 m³/s; no post-integration volume clamp |
| Coupled energy balance at dt=0.0020833333333333333 | multiphysics | 0 | -0.00012296132700839735 | 1.230e-4 | — | 0.1 | PASS | Electrical supply = thermal + rotor + hydrostatic storage + ambient + shaft export; explicit storage-head splitting |
| Coupled mass balance at dt=0.0010416666666666667 | multiphysics | 0 | -6.252776074688882e-13 | 6.253e-13 | — | 1e-7 | PASS | Finite tanks; nonlinear continuity tolerance 1e-12 m³/s; no post-integration volume clamp |
| Coupled energy balance at dt=0.0010416666666666667 | multiphysics | 0 | -0.00005481857508016219 | 5.482e-5 | — | 0.1 | PASS | Electrical supply = thermal + rotor + hydrostatic storage + ambient + shaft export; explicit storage-head splitting |
| Destination-volume convergence dt=0.016666666666666666 | multiphysics | 0.0009502988384601542 | 0.0009503158734076389 | 1.703e-8 | 1.793e-5 | 0.000002 | PASS | 2 s startup against dt=1/960 s reference; tolerance 2 mL |
| Motor-current convergence dt=0.016666666666666666 | multiphysics | 5.033419697226597 | 5.036700320444654 | 3.281e-3 | 6.518e-4 | 0.03 | PASS | 2 s startup; midpoint electrical/mechanical coupling; current tolerance 30 mA |
| Motor-speed convergence dt=0.016666666666666666 | multiphysics | 224.51510008083832 | 224.5151911157339 | 9.103e-5 | 4.055e-7 | 0.01 | PASS | 2 s startup; speed tolerance 0.01 rad/s |
| Fluid-temperature convergence dt=0.016666666666666666 | multiphysics | 293.1512652464488 | 293.1512660206903 | 7.742e-7 | 2.641e-9 | 0.001 | PASS | Conservative zero-volume enthalpy transport plus backward-Euler tank loss; tolerance 1 mK |
| Destination-volume convergence dt=0.008333333333333333 | multiphysics | 0.0009502988384601542 | 0.0009503158731852729 | 1.703e-8 | 1.793e-5 | 0.000002 | PASS | 2 s startup against dt=1/960 s reference; tolerance 2 mL |
| Motor-current convergence dt=0.008333333333333333 | multiphysics | 5.033419697226597 | 5.036700321118781 | 3.281e-3 | 6.518e-4 | 0.03 | PASS | 2 s startup; midpoint electrical/mechanical coupling; current tolerance 30 mA |
| Motor-speed convergence dt=0.008333333333333333 | multiphysics | 224.51510008083832 | 224.5151911056453 | 9.102e-5 | 4.054e-7 | 0.01 | PASS | 2 s startup; speed tolerance 0.01 rad/s |
| Fluid-temperature convergence dt=0.008333333333333333 | multiphysics | 293.1512652464488 | 293.1512660236139 | 7.772e-7 | 2.651e-9 | 0.001 | PASS | Conservative zero-volume enthalpy transport plus backward-Euler tank loss; tolerance 1 mK |
| Destination-volume convergence dt=0.004166666666666667 | multiphysics | 0.0009502988384601542 | 0.0009503158727734285 | 1.703e-8 | 1.793e-5 | 0.000002 | PASS | 2 s startup against dt=1/960 s reference; tolerance 2 mL |
| Motor-current convergence dt=0.004166666666666667 | multiphysics | 5.033419697226597 | 5.0367003223764035 | 3.281e-3 | 6.518e-4 | 0.03 | PASS | 2 s startup; midpoint electrical/mechanical coupling; current tolerance 30 mA |
| Motor-speed convergence dt=0.004166666666666667 | multiphysics | 224.51510008083832 | 224.51519108681265 | 9.101e-5 | 4.053e-7 | 0.01 | PASS | 2 s startup; speed tolerance 0.01 rad/s |
| Fluid-temperature convergence dt=0.004166666666666667 | multiphysics | 293.1512652464488 | 293.15126602507667 | 7.786e-7 | 2.656e-9 | 0.001 | PASS | Conservative zero-volume enthalpy transport plus backward-Euler tank loss; tolerance 1 mK |
| Destination-volume convergence dt=0.0020833333333333333 | multiphysics | 0.0009502988384601542 | 0.0009503044222056323 | 5.584e-9 | 5.876e-6 | 0.000002 | PASS | 2 s startup against dt=1/960 s reference; tolerance 2 mL |
| Motor-current convergence dt=0.0020833333333333333 | multiphysics | 5.033419697226597 | 5.034512816301193 | 1.093e-3 | 2.172e-4 | 0.03 | PASS | 2 s startup; midpoint electrical/mechanical coupling; current tolerance 30 mA |
| Motor-speed convergence dt=0.0020833333333333333 | multiphysics | 224.51510008083832 | 224.51511778862078 | 1.771e-5 | 7.887e-8 | 0.01 | PASS | 2 s startup; speed tolerance 0.01 rad/s |
| Fluid-temperature convergence dt=0.0020833333333333333 | multiphysics | 293.1512652464488 | 293.1512655061576 | 2.597e-7 | 8.859e-10 | 0.001 | PASS | Conservative zero-volume enthalpy transport plus backward-Euler tank loss; tolerance 1 mK |
| Halved internal timestep reduces volume error | multiphysics | 3 | 3.05069658725728 | 5.070e-2 | 1.690e-2 | 0.5 | PASS | dt=1/240 and 1/480 against dt=1/960 reference: first-order storage-head splitting predicts finite-reference error ratio 3 |
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
