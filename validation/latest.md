# Executed physics validation

Executed: 2026-10-10T14:31:04.423Z. 87/87 checks passed.

| Experiment | Domain | Expected | Measured | Absolute error | Relative error | Tolerance | Result | Assumptions |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 12 V / 6 Ω branch current | electrical | 2 | 2 | 0.000e+0 | 0.000e+0 | 1e-10 | PASS | Ideal source, 6 Ω constant resistance, ideal wires |
| 12 V × 2 A resistive power | electrical | 24 | 24 | 0.000e+0 | 0.000e+0 | 1e-9 | PASS | Independent Ohm-law reference |
| 24 W × 10 s energy | electrical | 240 | 240.00000000000233 | 2.331e-12 | 9.711e-15 | 1e-8 | PASS | Fixed-step rectangular integration; power constant |
| Net electrical power residual | electrical | 0 | 0 | 0.000e+0 | — | 1e-9 | PASS | Independent sum of ideal-source and branch powers |
| Disconnected load current | electrical | 0 | 0 | 0.000e+0 | — | 1e-10 | PASS | Open circuit, no leakage model |
| 10 kg water heated 20→80°C | thermal | 2508000 | 2508002.5946677467 | 2.595e+0 | 1.035e-6 | 33.33433333333333 | PASS | Step crossing bounded by one interval of ≤2 kW input; heater storage accounted separately |
| Isolated coupled heating conservation | coupling | 0 | -0.000016620848327875137 | 1.662e-5 | — | 0.001 | PASS | Backward Euler symmetric immersion transfer; tolerance 1 mJ over ~2.5 MJ |
| OFF removes new electrical energy | coupling | 2530188.1291187955 | 2530188.1291187955 | 0.000e+0 | 0.000e+0 | 1e-8 | PASS | Stored thermal energy remains, heater electrical branch failed open |
| Thermal inertia still warms water | coupling | 1 | 1 | 0.000e+0 | 0.000e+0 | 0 | PASS | Hot element retains sensible energy after power removal |
| Ambient cooling convergence dt=0.100000 s | thermal | 78.13486761123998 | 78.13487244236272 | 4.831e-6 | 6.183e-8 | 0.000005001135734072023 | PASS | Analytic exponential cooling; first-order BE error bound ΔT λ² t dt / 2 |
| Cooling conservation dt=0.100000 s | thermal | 0 | 5.497277015820146e-7 | 5.497e-7 | — | 0.001 | PASS | Signed external heat and stored thermal change; no power source |
| Ambient cooling convergence dt=0.050000 s | thermal | 78.13486761123998 | 78.13487002686408 | 2.416e-6 | 3.092e-8 | 0.0000025055678670360114 | PASS | Analytic exponential cooling; first-order BE error bound ΔT λ² t dt / 2 |
| Cooling conservation dt=0.050000 s | thermal | 0 | -0.0000022109306883066893 | 2.211e-6 | — | 0.001 | PASS | Signed external heat and stored thermal change; no power source |
| Ambient cooling convergence dt=0.025000 s | thermal | 78.13486761123998 | 78.13486881907863 | 1.208e-6 | 1.546e-8 | 0.0000012577839335180056 | PASS | Analytic exponential cooling; first-order BE error bound ΔT λ² t dt / 2 |
| Cooling conservation dt=0.025000 s | thermal | 0 | -0.0000021916930563747883 | 2.192e-6 | — | 0.001 | PASS | Signed external heat and stored thermal change; no power source |
| Ambient cooling convergence dt=0.016667 s | thermal | 78.13486761123998 | 78.13486841622245 | 8.050e-7 | 1.030e-8 | 8.418559556786704e-7 | PASS | Analytic exponential cooling; first-order BE error bound ΔT λ² t dt / 2 |
| Cooling conservation dt=0.016667 s | thermal | 0 | 0.000008882343536242843 | 8.882e-6 | — | 0.001 | PASS | Signed external heat and stored thermal change; no power source |
| Halving timestep approximately halves error | numerical | 2 | 1.9999480658328985 | 5.193e-5 | 2.597e-5 | 0.001 | PASS | Backward Euler first-order convergence for smooth single-mass cooling |
| Closed relay and safety current | electrical | 8.324661810613943 | 8.324661810613941 | 1.776e-15 | 2.134e-16 | 1e-9 | PASS | Finite series contact resistances 0.02 Ω and 0.01 Ω |
| Closed-loop regulation inside plausible bounds | automation | 1 | 1 | 0.000e+0 | 0.000e+0 | 0 | PASS | 78/80°C hysteresis; finite element inertia and 8 W/K cooling |
| Long run energy conservation | coupling | 0 | 0.000028676935471594334 | 2.868e-5 | — | 0.001 | PASS | All contact/element heat storage and ambient/coolant exchange included |
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
| Coupled mass balance at dt=0.016666666666666666 | multiphysics | 0 | -8.15703060652595e-12 | 8.157e-12 | — | 1e-7 | PASS | Finite tanks; nonlinear continuity tolerance 1e-12 m³/s; no post-integration volume clamp |
| Coupled energy balance at dt=0.016666666666666666 | multiphysics | 0 | -0.0002234730893633241 | 2.235e-4 | — | 0.1 | PASS | Electrical supply = thermal + rotor + hydrostatic storage + ambient + shaft export; explicit storage-head splitting |
| Coupled mass balance at dt=0.008333333333333333 | multiphysics | 0 | -6.87805368215777e-12 | 6.878e-12 | — | 1e-7 | PASS | Finite tanks; nonlinear continuity tolerance 1e-12 m³/s; no post-integration volume clamp |
| Coupled energy balance at dt=0.008333333333333333 | multiphysics | 0 | -0.00022351555992372596 | 2.235e-4 | — | 0.1 | PASS | Electrical supply = thermal + rotor + hydrostatic storage + ambient + shaft export; explicit storage-head splitting |
| Coupled mass balance at dt=0.004166666666666667 | multiphysics | 0 | -3.922195901395753e-12 | 3.922e-12 | — | 1e-7 | PASS | Finite tanks; nonlinear continuity tolerance 1e-12 m³/s; no post-integration volume clamp |
| Coupled energy balance at dt=0.004166666666666667 | multiphysics | 0 | -0.00022396114468392625 | 2.240e-4 | — | 0.1 | PASS | Electrical supply = thermal + rotor + hydrostatic storage + ambient + shaft export; explicit storage-head splitting |
| Coupled mass balance at dt=0.0020833333333333333 | multiphysics | 0 | -1.9042545318370685e-12 | 1.904e-12 | — | 1e-7 | PASS | Finite tanks; nonlinear continuity tolerance 1e-12 m³/s; no post-integration volume clamp |
| Coupled energy balance at dt=0.0020833333333333333 | multiphysics | 0 | -0.00011390215598794384 | 1.139e-4 | — | 0.1 | PASS | Electrical supply = thermal + rotor + hydrostatic storage + ambient + shaft export; explicit storage-head splitting |
| Coupled mass balance at dt=0.0010416666666666667 | multiphysics | 0 | -1.7053025658242404e-13 | 1.705e-13 | — | 1e-7 | PASS | Finite tanks; nonlinear continuity tolerance 1e-12 m³/s; no post-integration volume clamp |
| Coupled energy balance at dt=0.0010416666666666667 | multiphysics | 0 | -0.00005620914890869244 | 5.621e-5 | — | 0.1 | PASS | Electrical supply = thermal + rotor + hydrostatic storage + ambient + shaft export; explicit storage-head splitting |
| Destination-volume convergence dt=0.016666666666666666 | multiphysics | 0.0009082284935436316 | 0.0009082414376902604 | 1.294e-8 | 1.425e-5 | 0.000002 | PASS | 2 s startup against dt=1/960 s reference; tolerance 2 mL |
| Motor-current convergence dt=0.016666666666666666 | multiphysics | 5.8855676587050265 | 5.888059887298688 | 2.492e-3 | 4.234e-4 | 0.03 | PASS | 2 s startup; midpoint electrical/mechanical coupling; current tolerance 30 mA |
| Motor-speed convergence dt=0.016666666666666666 | multiphysics | 211.7289478051347 | 211.72905430020802 | 1.065e-4 | 5.030e-7 | 0.01 | PASS | 2 s startup; speed tolerance 0.01 rad/s |
| Fluid-temperature convergence dt=0.016666666666666666 | multiphysics | 293.1512044874853 | 293.15120619461123 | 1.707e-6 | 5.823e-9 | 0.001 | PASS | Conservative zero-volume enthalpy transport plus backward-Euler tank loss; tolerance 1 mK |
| Destination-volume convergence dt=0.008333333333333333 | multiphysics | 0.0009082284935436316 | 0.000908241437691323 | 1.294e-8 | 1.425e-5 | 0.000002 | PASS | 2 s startup against dt=1/960 s reference; tolerance 2 mL |
| Motor-current convergence dt=0.008333333333333333 | multiphysics | 5.8855676587050265 | 5.888059887283094 | 2.492e-3 | 4.234e-4 | 0.03 | PASS | 2 s startup; midpoint electrical/mechanical coupling; current tolerance 30 mA |
| Motor-speed convergence dt=0.008333333333333333 | multiphysics | 211.7289478051347 | 211.7290543004413 | 1.065e-4 | 5.030e-7 | 0.01 | PASS | 2 s startup; speed tolerance 0.01 rad/s |
| Fluid-temperature convergence dt=0.008333333333333333 | multiphysics | 293.1512044874853 | 293.15120619751997 | 1.710e-6 | 5.833e-9 | 0.001 | PASS | Conservative zero-volume enthalpy transport plus backward-Euler tank loss; tolerance 1 mK |
| Destination-volume convergence dt=0.004166666666666667 | multiphysics | 0.0009082284935436316 | 0.0009082414376934974 | 1.294e-8 | 1.425e-5 | 0.000002 | PASS | 2 s startup against dt=1/960 s reference; tolerance 2 mL |
| Motor-current convergence dt=0.004166666666666667 | multiphysics | 5.8855676587050265 | 5.888059887255765 | 2.492e-3 | 4.234e-4 | 0.03 | PASS | 2 s startup; midpoint electrical/mechanical coupling; current tolerance 30 mA |
| Motor-speed convergence dt=0.004166666666666667 | multiphysics | 211.7289478051347 | 211.72905430086695 | 1.065e-4 | 5.030e-7 | 0.01 | PASS | 2 s startup; speed tolerance 0.01 rad/s |
| Fluid-temperature convergence dt=0.004166666666666667 | multiphysics | 293.1512044874853 | 293.1512061989742 | 1.711e-6 | 5.838e-9 | 0.001 | PASS | Conservative zero-volume enthalpy transport plus backward-Euler tank loss; tolerance 1 mK |
| Destination-volume convergence dt=0.0020833333333333333 | multiphysics | 0.0009082284935436316 | 0.0009082234102210463 | 5.083e-9 | 5.597e-6 | 0.000002 | PASS | 2 s startup against dt=1/960 s reference; tolerance 2 mL |
| Motor-current convergence dt=0.0020833333333333333 | multiphysics | 5.8855676587050265 | 5.886396075908988 | 8.284e-4 | 1.408e-4 | 0.03 | PASS | 2 s startup; midpoint electrical/mechanical coupling; current tolerance 30 mA |
| Motor-speed convergence dt=0.0020833333333333333 | multiphysics | 211.7289478051347 | 211.72900116383437 | 5.336e-5 | 2.520e-7 | 0.01 | PASS | 2 s startup; speed tolerance 0.01 rad/s |
| Fluid-temperature convergence dt=0.0020833333333333333 | multiphysics | 293.1512044874853 | 293.1512050858146 | 5.983e-7 | 2.041e-9 | 0.001 | PASS | Conservative zero-volume enthalpy transport plus backward-Euler tank loss; tolerance 1 mK |
| Halved internal timestep reduces volume error | multiphysics | 3 | 2.546395521524538 | 4.536e-1 | 1.512e-1 | 0.5 | PASS | dt=1/240 and 1/480 against dt=1/960 reference: first-order storage-head splitting predicts finite-reference error ratio 3 |
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
| Electrical-spatial shaft energy balance dt=0.016666666666666666 | mechanical | 0 | -8.028600007037312e-11 | 8.029e-11 | — | 0.001 | PASS | Implicit motor midpoint coupled to Planck mass matrix; copper/friction/brake losses explicit |
| Authoritative motor/body shaft speed dt=0.016666666666666666 | mechanical | 0 | 0 | 0.000e+0 | — | 0 | PASS | One angular velocity; rotor inertia added to rigid-body inertia exactly once |
| Electrical-spatial speed convergence dt=0.016666666666666666 | mechanical | 64.26298311651148 | 64.26387263936584 | 8.895e-4 | 1.384e-5 | 0.005 | PASS | 2 s against dt=1/960 s reference; fixed duty and viscous shaft brake |
| Electrical-spatial current convergence dt=0.016666666666666666 | mechanical | 31.96891350689891 | 31.97058903968633 | 1.676e-3 | 5.241e-5 | 0.01 | PASS | MNA back EMF; latest midpoint current has O(h) reporting offset; tolerance 10 mA |
| Electrical-spatial shaft energy balance dt=0.004166666666666667 | mechanical | 0 | -3.725553199274145e-11 | 3.726e-11 | — | 0.001 | PASS | Implicit motor midpoint coupled to Planck mass matrix; copper/friction/brake losses explicit |
| Authoritative motor/body shaft speed dt=0.004166666666666667 | mechanical | 0 | 0 | 0.000e+0 | — | 0 | PASS | One angular velocity; rotor inertia added to rigid-body inertia exactly once |
| Electrical-spatial speed convergence dt=0.004166666666666667 | mechanical | 64.26298311651148 | 64.26387263936584 | 8.895e-4 | 1.384e-5 | 0.005 | PASS | 2 s against dt=1/960 s reference; fixed duty and viscous shaft brake |
| Electrical-spatial current convergence dt=0.004166666666666667 | mechanical | 31.96891350689891 | 31.97058903968633 | 1.676e-3 | 5.241e-5 | 0.01 | PASS | MNA back EMF; latest midpoint current has O(h) reporting offset; tolerance 10 mA |
| Electrical-spatial shaft energy balance dt=0.0020833333333333333 | mechanical | 0 | -1.9135804052439198e-10 | 1.914e-10 | — | 0.001 | PASS | Implicit motor midpoint coupled to Planck mass matrix; copper/friction/brake losses explicit |
| Authoritative motor/body shaft speed dt=0.0020833333333333333 | mechanical | 0 | 0 | 0.000e+0 | — | 0 | PASS | One angular velocity; rotor inertia added to rigid-body inertia exactly once |
| Electrical-spatial speed convergence dt=0.0020833333333333333 | mechanical | 64.26298311651148 | 64.26387263936584 | 8.895e-4 | 1.384e-5 | 0.005 | PASS | 2 s against dt=1/960 s reference; fixed duty and viscous shaft brake |
| Electrical-spatial current convergence dt=0.0020833333333333333 | mechanical | 31.96891350689891 | 31.97058903968633 | 1.676e-3 | 5.241e-5 | 0.01 | PASS | MNA back EMF; latest midpoint current has O(h) reporting offset; tolerance 10 mA |
| Electrical-spatial shaft energy balance dt=0.0010416666666666667 | mechanical | 0 | -2.1326940213839407e-11 | 2.133e-11 | — | 0.001 | PASS | Implicit motor midpoint coupled to Planck mass matrix; copper/friction/brake losses explicit |
| Authoritative motor/body shaft speed dt=0.0010416666666666667 | mechanical | 0 | 0 | 0.000e+0 | — | 0 | PASS | One angular velocity; rotor inertia added to rigid-body inertia exactly once |
| Finer shaft step reduces speed error | mechanical | 1 | 1 | 0.000e+0 | 0.000e+0 | 0 | PASS | h=1/480 against h=1/960 s reference; speed difference below 1 mrad/s |
