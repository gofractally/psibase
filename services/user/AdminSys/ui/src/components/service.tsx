type ServiceConfig = {
    host: string;
    root: string;
};

export type ServiceProps = {
    register: (name: `${number}.root` | `${number}.host`) => any;
    index: number;
    services: any;
};

export const Service = ({ register, index, services }: ServiceProps) => {
    return (
        <div className="service-control">
            <input {...register(`${index}.host`)} />
            <input {...register(`${index}.root`)} />
            <button onClick={() => services.remove(index)}>Remove</button>
        </div>
    );
};

export default Service;
